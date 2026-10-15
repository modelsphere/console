import type { ModelVariant, Node } from "@swiss/lib/api";
import type { Facets, SortKey } from "@swiss/lib/catalog";
import { matchesVendor } from "@swiss/lib/gpu";

// The catalog page's filters, in swiss's query parameter names so links between
// the two pages keep meaning the same thing.
export interface CatalogFilters {
  q: string;
  family: string;
  engine: string;
  hardware: string;
  tag: string;
  tuned: boolean;
  hidedep: boolean;
  sort: SortKey;
}

export function filtersFrom(p: URLSearchParams): CatalogFilters {
  const get = (k: string) => p.get(k) ?? "";
  const sort = get("sort");
  return {
    q: get("q"),
    family: get("family"),
    engine: get("engine"),
    hardware: get("hardware"),
    tag: get("tag"),
    tuned: get("tuned") === "1",
    hidedep: get("hidedep") === "1",
    sort: sort === "uplift" || sort === "family" ? sort : "name",
  };
}

export function withFilters(prev: URLSearchParams, patch: Partial<CatalogFilters>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [k, v] of Object.entries(patch)) {
    if (v === true) next.set(k, "1");
    else if (!v || (k === "sort" && v === "name")) next.delete(k);
    else next.set(k, String(v));
  }
  return next;
}

// Keeps only the catalog: clearing filters does not leave the catalog chosen.
export function withoutFilters(prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const c = prev.get("catalog");
  if (c) next.set("catalog", c);
  return next;
}

export function activeFilters(f: CatalogFilters): (keyof CatalogFilters)[] {
  return (["q", "family", "engine", "hardware", "tag", "tuned", "hidedep"] as const).filter((k) => !!f[k]);
}

export function matches(x: Facets, f: CatalogFilters): boolean {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return (
    terms.every((t) => x.text.includes(t)) &&
    (!f.family || x.model.family === f.family) &&
    (!f.engine || x.engines.includes(f.engine)) &&
    (!f.hardware || x.hardware.includes(f.hardware)) &&
    (!f.tag || (x.model.tags ?? []).includes(f.tag)) &&
    (!f.tuned || !!x.cmp) &&
    (!f.hidedep || !x.deprecated)
  );
}

export interface Option {
  value: string;
  count: number;
}

export function facetOptions(all: Facets[]) {
  const tally = (pick: (x: Facets) => (string | undefined)[]) => {
    const n = new Map<string, number>();
    for (const x of all) for (const v of new Set(pick(x).filter((s): s is string => !!s))) n.set(v, (n.get(v) ?? 0) + 1);
    return [...n].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return {
    family: tally((x) => [x.model.family]),
    engine: tally((x) => x.engines),
    hardware: tally((x) => x.hardware),
    tag: tally((x) => x.model.tags ?? []),
  };
}

export interface Fit {
  ok: boolean;
  matching: number;
  needed: number;
}

// Whether the cluster has nodes a variant can land on right now: schedulable,
// enough GPUs of the right vendor and product, as many as it spans.
export function fitness(v: Pick<ModelVariant, "requires">, nodes?: Node[]): Fit | null {
  if (!nodes) return null;
  const matching = nodes.filter(
    (n) =>
      n.Schedulable &&
      n.GPUs >= v.requires.gpus &&
      matchesVendor(v.requires.vendor, n) &&
      (!v.requires.gpuProduct?.length || v.requires.gpuProduct.includes(n.GPUProduct)),
  ).length;
  const needed = v.requires.nodes ?? 1;
  return { ok: matching >= needed, matching, needed };
}

export const catalogPath = (catalog: string) => (catalog ? `catalog?catalog=${encodeURIComponent(catalog)}` : "catalog");
export function modelPath(name: string, catalog: string, version?: string) {
  const q = new URLSearchParams();
  if (catalog) q.set("catalog", catalog);
  if (version) q.set("version", version);
  return `catalog/${encodeURIComponent(name)}${q.size ? `?${q}` : ""}`;
}
