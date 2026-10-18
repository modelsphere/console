import type { SiteProfile } from "@swiss/lib/api";

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

// nodes.gpuProductAliases is product -> node label selectors. It is edited as
// one row per selector: a map keyed by what is being typed loses the row the
// moment a product name is briefly empty or matches another.
export interface AliasRow {
  product: string;
  selector: string;
}

export type AliasError = "required" | "format" | "conflict";

export function aliasRows(aliases?: Record<string, string[]>): AliasRow[] {
  return Object.entries(aliases ?? {}).flatMap(([product, sels]) => sels.map((selector) => ({ product, selector })));
}

// Back to the stored shape. A row with neither field is one just added and is
// left out. Any other row is kept as typed, so a half-filled one is refused at
// save rather than silently dropped.
export function aliasMap(rows: AliasRow[]): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const product = r.product.trim();
    const selector = r.selector.trim();
    if (!product && !selector) continue;
    (out[product] ??= []).push(selector);
  }
  return Object.keys(out).length ? out : undefined;
}

// A selector is key=value pairs joined by commas, every one required.
function parseSelector(sel: string): Record<string, string> | undefined {
  const labels: Record<string, string> = {};
  for (const pair of sel.split(",")) {
    const at = pair.indexOf("=");
    const k = pair.slice(0, at).trim();
    const v = pair.slice(at + 1).trim();
    if (at < 0 || !k || !v || (k in labels && labels[k] !== v)) return undefined;
    labels[k] = v;
  }
  return labels;
}

// swissd's rules for aliases. A node matching two products takes the one with
// more pairs, so two selectors of one size that a single node could satisfy
// are refused: both rows are flagged.
export function aliasErrors(rows: AliasRow[]): { product?: AliasError; selector?: AliasError }[] {
  const parsed = rows.map((r) => (r.selector.trim() ? parseSelector(r.selector) : undefined));
  const overlap = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => !(k in b) || b[k] === v);
  return rows.map((r, i) => {
    const product = r.product.trim();
    const selector = r.selector.trim();
    const e: { product?: AliasError; selector?: AliasError } = {};
    if (!product && !selector) return e;
    if (!product) e.product = "required";
    const mine = parsed[i];
    if (!selector) e.selector = "required";
    else if (!mine) e.selector = "format";
    else if (rows.some((o, j) => parsed[j] && o.product.trim() !== product && overlap(mine, parsed[j]!))) e.selector = "conflict";
    return e;
  });
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
