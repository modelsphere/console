import { parse, stringify } from "yaml";
import type { GPUSpec, Preset, SiteProfile } from "@swiss/lib/api";
import { isMap } from "@swiss/lib/formLayer";

export type CatalogError = "required" | "format" | "duplicate";

// swissd's rules for catalogs, so a bad row is flagged before the save is
// refused. One url may be listed twice under the two schemas.
export function catalogErrors(catalogs: SiteProfile["catalogs"] = []): { name?: CatalogError; url?: CatalogError }[] {
  const names = new Set<string>();
  const keys = new Set<string>();
  return catalogs.map((c) => {
    const name = c.name.trim();
    const url = c.url.trim();
    const key = `${c.schemaVersion === "v2" ? "v2" : "v1"} ${url}`;
    const e: { name?: CatalogError; url?: CatalogError } = {};
    if (!name) e.name = "required";
    else if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name)) e.name = "format";
    else if (names.has(name)) e.name = "duplicate";
    if (!url) e.url = "required";
    else if (!/^(https?:\/\/|\/)/.test(url)) e.url = "format";
    else if (keys.has(key)) e.url = "duplicate";
    names.add(name);
    keys.add(key);
    return e;
  });
}

// nodes.gpus as the forms hold it while typed: a product's label values as the
// comma-separated text in its box.
export interface GPURow {
  vendor: string;
  resource: string;
  labelKey: string;
  products: { product: string; values: string }[];
}

export type GPUError = "required" | "duplicate" | "conflict";
export interface GPURowErrors {
  vendor?: GPUError;
  resource?: GPUError;
  labelKey?: GPUError;
  products: { product?: GPUError; values?: GPUError }[];
}

export const emptyGPURow = (): GPURow => ({ vendor: "", resource: "", labelKey: "", products: [] });

export function gpuRows(gpus?: GPUSpec[]): GPURow[] {
  return (gpus ?? []).map((g) => ({
    vendor: g.vendor ?? "",
    resource: g.resource ?? "",
    labelKey: g.labelKey ?? "",
    products: (g.products ?? []).map((p) => ({ product: p.product ?? "", values: (p.values ?? []).join(", ") })),
  }));
}

const splitValues = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
const blankProduct = (p: GPURow["products"][number]) => !p.product.trim() && !splitValues(p.values).length;
const blankRow = (r: GPURow) => !r.vendor.trim() && !r.resource.trim() && !r.labelKey.trim() && r.products.every(blankProduct);

// Back to the stored list, never undefined: [] is a site without GPUs. Rows
// left blank are ones just added; anything else is kept as typed, so a
// half-filled row is refused at save rather than silently dropped.
export function gpuTable(rows: GPURow[]): GPUSpec[] {
  return rows.filter((r) => !blankRow(r)).map((r) => {
    const products = r.products.filter((p) => !blankProduct(p)).map((p) => {
      const values = splitValues(p.values);
      return values.length ? { product: p.product.trim(), values } : { product: p.product.trim() };
    });
    return { vendor: r.vendor.trim(), resource: r.resource.trim(), labelKey: r.labelKey.trim(), ...(products.length ? { products } : {}) };
  });
}

// swissd's rules: vendor, resource and labelKey required, a resource listed
// once, and under it a product listed once and a label value naming one product.
export function gpuErrors(rows: GPURow[]): GPURowErrors[] {
  const resources = new Set<string>();
  return rows.map((r) => {
    const e: GPURowErrors = { products: r.products.map(() => ({})) };
    if (blankRow(r)) return e;
    const resource = r.resource.trim();
    if (!r.vendor.trim()) e.vendor = "required";
    if (!resource) e.resource = "required";
    else if (resources.has(resource)) e.resource = "duplicate";
    resources.add(resource);
    if (!r.labelKey.trim()) e.labelKey = "required";
    const products = new Set<string>();
    const names = new Map<string, string>();
    r.products.forEach((p, i) => {
      if (blankProduct(p)) return;
      const product = p.product.trim();
      const pe = e.products[i];
      if (!product) pe.product = "required";
      else if (products.has(product)) pe.product = "duplicate";
      products.add(product);
      const claim = (name: string, field: "product" | "values") => {
        const other = names.get(name);
        if (other !== undefined && other !== product) pe[field] ??= "conflict";
        names.set(name, product);
      };
      if (product) claim(product, "product");
      for (const v of splitValues(p.values)) claim(v, "values");
    });
    return e;
  });
}

export const hasGPUErrors = (errs: GPURowErrors[]) =>
  errs.some((e) => e.vendor || e.resource || e.labelKey || e.products.some((p) => p.product || p.values));

// One entry as the dialog edits it, checked against the entries beside it. A
// blank entry is not one just added here: it is missing everything.
export function gpuEntryErrors(row: GPURow, others: GPUSpec[]): GPURowErrors {
  const e = gpuErrors([...gpuRows(others), row]).at(-1)!;
  return blankRow(row) ? { ...e, vendor: "required", resource: "required", labelKey: "required" } : e;
}

// The first entry of a vendor is its default resource.
export const isVendorDefault = (rows: { vendor: string }[], i: number) =>
  !!rows[i].vendor.trim() && rows.findIndex((r) => r.vendor.trim() === rows[i].vendor.trim()) === i;

export interface Placed<T> {
  entry: T;
  // The entry's place in the stored list.
  index: number;
}

// Entries in a remembered order of resources, so a table keeps its rows where
// they were when it opened; one not in it goes last.
export function inOrder<T extends { resource: string }>(rows: T[], order: string[]): Placed<T>[] {
  const at = (r: string) => (order.includes(r) ? order.indexOf(r) : order.length);
  return rows.map((entry, index) => ({ entry, index })).sort((a, b) => at(a.entry.resource) - at(b.entry.resource) || a.index - b.index);
}

// Entries by vendor, vendors in the order they first appear, each keeping its
// entries' order.
export function vendorGroups<T extends { vendor: string }>(rows: Placed<T>[]): { vendor: string; entries: Placed<T>[] }[] {
  const groups = new Map<string, Placed<T>[]>();
  for (const r of rows) {
    const v = r.entry.vendor.trim();
    groups.set(v, [...(groups.get(v) ?? []), r]);
  }
  return [...groups].map(([vendor, entries]) => ({ vendor, entries }));
}

// Moves row i ahead of its vendor's current default.
export function makeVendorDefault<T extends { vendor: string }>(rows: T[], i: number): T[] {
  const first = rows.findIndex((r) => r.vendor.trim() === rows[i].vendor.trim());
  if (first < 0 || first >= i) return rows;
  const next = rows.filter((_, j) => j !== i);
  next.splice(first, 0, rows[i]);
  return next;
}

// defaults.features, the switches a deploy starts from unless the variant sets
// its own. Unset is on. Routing is route.enabled, a site fact.
export type FeatureKey = keyof NonNullable<NonNullable<SiteProfile["defaults"]>["features"]>;
export const FEATURES: FeatureKey[] = ["cart", "serviceMonitor", "sloRequirement", "scaler"];

export function featureOn(defaults: SiteProfile["defaults"], key: FeatureKey): boolean {
  return defaults?.features?.[key] ?? true;
}

// withFeature sets one switch. On is stored as unset, since unset is on, and a
// section left with nothing set is no section at all.
export function withFeature(defaults: SiteProfile["defaults"], key: FeatureKey, on: boolean): SiteProfile["defaults"] {
  const features = { ...defaults?.features };
  if (on) delete features[key];
  else features[key] = false;
  const next = { ...defaults, features: Object.keys(features).length ? features : undefined };
  if (!next.features) delete next.features;
  return Object.keys(next).length ? next : undefined;
}

// A preset as its editor holds it, the values as YAML.
export interface PresetRow {
  name: string;
  description: string;
  values: string;
}

export interface PresetErrors {
  name?: "required" | "duplicate";
  values?: "yaml" | "map";
  // The YAML parser's message.
  yaml?: string;
}

export const presetRow = (name = "", p?: Preset): PresetRow => ({ name, description: p?.description ?? "", values: p?.values ? stringify(p.values) : "" });

// others: the names of the presets this row is not.
export function presetErrors(row: PresetRow, others: string[]): PresetErrors {
  const errs: PresetErrors = {};
  const name = row.name.trim();
  if (!name) errs.name = "required";
  else if (others.includes(name)) errs.name = "duplicate";
  try {
    const v: unknown = parse(row.values);
    if (v != null && !isMap(v)) errs.values = "map";
  } catch (e) {
    errs.values = "yaml";
    errs.yaml = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  return errs;
}

export const hasPresetErrors = (e: PresetErrors) => !!(e.name || e.values);

// putPreset stores a row that has no errors, under its name, in place of the
// preset named from; a profile left with none has no presets at all.
export function putPreset(presets: SiteProfile["presets"], from: string | undefined, row?: PresetRow): SiteProfile["presets"] {
  const next = { ...presets };
  if (from !== undefined) delete next[from];
  if (row) {
    const values = parse(row.values) as Preset["values"] | null;
    next[row.name.trim()] = { ...(row.description.trim() && { description: row.description.trim() }), ...(values && { values }) };
  }
  return Object.keys(next).length ? next : undefined;
}
