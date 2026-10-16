import type { SiteProfile } from "@swiss/lib/api";
import { aliasErrors, aliasRows, catalogErrors } from "@swiss/lib/profile";

export interface Row {
  key: string;
  value: string;
}

export function toRows(r?: Record<string, string>): Row[] {
  return Object.entries(r ?? {}).map(([key, value]) => ({ key, value }));
}

// A row without a key is one being typed, not a value: it is left out, and an
// empty table is no table at all.
export function fromRows(rows: Row[]): Record<string, string> | undefined {
  const kept = rows.filter((r) => r.key.trim());
  return kept.length ? Object.fromEntries(kept.map((r) => [r.key.trim(), r.value])) : undefined;
}

export function profileErrors(p: SiteProfile): ("name" | "pathTemplate" | "catalogs" | "gpuAliases")[] {
  const errs: ("name" | "pathTemplate" | "catalogs" | "gpuAliases")[] = [];
  if (!p.name?.trim()) errs.push("name");
  if (!p.model?.pathTemplate?.trim()) errs.push("pathTemplate");
  if (catalogErrors(p.catalogs).some((e) => e.name || e.url)) errs.push("catalogs");
  if (aliasErrors(aliasRows(p.nodes?.gpuProductAliases)).some((e) => e.product || e.selector)) errs.push("gpuAliases");
  return errs;
}

// nodes with one field replaced: the others ride along, and nothing set is no
// nodes section at all.
export function withNodes(nodes: SiteProfile["nodes"], patch: NonNullable<SiteProfile["nodes"]>): SiteProfile["nodes"] {
  const next = { ...nodes, ...patch };
  return next.gpusPerNode === undefined && !next.gpuProductAliases ? undefined : next;
}

// One catalog marked default at most: marking one clears the others.
export function markDefault(catalogs: NonNullable<SiteProfile["catalogs"]>, index: number, on: boolean) {
  return catalogs.map((c, i) => ({ ...c, default: i === index ? on : on ? false : c.default }));
}
