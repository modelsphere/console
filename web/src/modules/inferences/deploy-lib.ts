import type { ChartVersions, DiffResult, Node, Plan } from "@swiss/lib/api";
import { DIRECTIVES_BY_KEY } from "@swiss/lib/routeDirectives";
import type { Form, Toleration } from "@swiss/components/DeploySettings";

// Ported from swiss's DeploySettings, where they are not exported.

// openresty ignores anything outside (0, 1] and falls back to 0.4.
export function fracOutOfRange(raw: string): boolean {
  const s = raw.trim();
  if (s === "") return false;
  const n = Number(s);
  return !Number.isFinite(n) || n <= 0 || n > 1;
}

export function extraValue(f: Pick<Form, "nginxExtras">, key: string): string {
  return f.nginxExtras.find((r) => r.key === key)?.value.trim() ?? "";
}

export function initialValue(key: string): string {
  const d = DIRECTIVES_BY_KEY.get(key);
  if (d?.kind !== "boolean") return "";
  return d.fallback === "on" ? "true" : "false";
}

// Route values the form sets through its own fields; they count against the CRD's cap too.
export const NAMED_VALUES = new Set(["expose_routed_peer", "ttft_limit_ms", "tps_limit_tps", "adaptive_cc", "adaptive_cc_min_frac"]);

export interface ChartChoice {
  loading: boolean;
  error?: string;
  // Empty when the catalog pins one version: nothing to choose.
  options: string[];
  pinned: boolean;
  range?: string;
  // What an empty choice installs: the running version if it is still in range, else the newest.
  fallback?: string;
  keep: boolean;
  resolved?: string;
}

export function chartChoice(list: { data?: ChartVersions; error?: Error | null }, value: string, running?: Plan["chart"]): ChartChoice {
  if (list.error) return { loading: false, error: list.error.message, options: [], pinned: false, keep: false, resolved: value || running?.version };
  const d = list.data;
  if (!d) return { loading: true, options: [], pinned: false, keep: false };
  const pinned = d.versions.length === 1 && d.versions[0] === d.range;
  const keep = !!running && running.name === d.chart && d.versions.includes(running.version);
  const fallback = keep ? running!.version : d.versions[0];
  return { loading: false, options: pinned ? [] : d.versions, pinned, range: d.range, fallback, keep, resolved: value || fallback };
}

export type Action = "install" | "apply" | "rollback";

// The dry run decides install vs apply, and whether there is anything to apply.
export function pipelineState(o: { rollback?: boolean; diff: DiffResult | null; exists?: boolean; applied: boolean }) {
  const exists = o.diff?.exists ?? o.exists;
  const action: Action = o.rollback ? "rollback" : exists === false ? "install" : "apply";
  const dryRunDone = !!o.diff;
  return {
    action,
    dryRunDone,
    nothingToDo: dryRunDone && !o.diff!.changed,
    canApply: dryRunDone && o.diff!.changed && !o.applied && exists !== undefined,
    // Forcing helm's field ownership only means anything on an upgrade.
    canForce: action === "apply",
  };
}

export interface Change {
  key: "catalog" | "version" | "chart" | "digest" | "variant";
  from?: string;
  to?: string;
  changed: boolean;
}

export function whatMoves(current: Plan, proposed: Plan, currentCatalog?: string): Change[] {
  const row = (key: Change["key"], from?: string, to?: string): Change => ({ key, from, to, changed: (from ?? "") !== (to ?? "") });
  return [
    row("catalog", currentCatalog, proposed.source.catalogName ?? currentCatalog),
    row("version", current.source.version, proposed.source.version),
    row("chart", `${current.chart.name}-${current.chart.version}`, `${proposed.chart.name}-${proposed.chart.version}`),
    row("digest", current.source.digest?.slice(7, 19), proposed.source.digest?.slice(7, 19)),
    row("variant", current.source.variant, proposed.source.variant),
  ];
}

export const SECTIONS = ["basic", "resources", "routing", "advanced"] as const;
export type Section = (typeof SECTIONS)[number];

// The service id names the helm release and the Services the chart renders
// from it ("<id>-cart"), so it has to be a DNS-1035 label: no dots, starting
// with a letter. 53 is helm's limit for a release name.
export function serviceIdError(id: string): "required" | "format" | "length" | undefined {
  if (!id.trim()) return "required";
  if (id.length > 53) return "length";
  if (!/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(id)) return "format";
  return undefined;
}

export function defaultServiceId(model: string): string {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 53)
    .replace(/-+$/, "");
}

export interface ClusterTaint {
  // As /api/nodes lists it: key=value:Effect.
  taint: string;
  nodes: number;
  toleration: Toleration;
}

// clusterTaints is each taint the nodes carry, once, with how many carry it.
// Kubernetes' own node.kubernetes.io/* taints (not-ready, unschedulable, ...)
// follow a node's state, so they are not offered.
export function clusterTaints(nodes: Node[] | undefined): ClusterTaint[] {
  const count = new Map<string, number>();
  for (const n of nodes ?? []) for (const t of new Set(n.Taints ?? [])) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count]
    .flatMap(([taint, nodes]) => {
      const toleration = taintToleration(taint);
      return toleration && !toleration.key.startsWith("node.kubernetes.io/") ? [{ taint, nodes, toleration }] : [];
    })
    .sort((a, b) => a.taint.localeCompare(b.taint));
}

// taintToleration is the toleration matching key=value:Effect exactly; a taint
// with no value is matched by Exists.
export function taintToleration(taint: string): Toleration | undefined {
  const m = /^([^=:]+)=([^=:]*):(\w+)$/.exec(taint);
  if (!m) return undefined;
  const [, key, value, effect] = m;
  return value ? { key, operator: "Equal", value, effect } : { key, operator: "Exists", value: "", effect };
}

export const sameToleration = (a: Toleration, b: Toleration) =>
  a.key.trim() === b.key && a.operator === b.operator && (a.operator === "Exists" || a.value.trim() === b.value) && a.effect === b.effect;

// pickTaints sets rows to tolerate exactly the picked taints among those
// offered: a row for each picked one, none for the rest, and every row that
// matches no offered taint kept as it is.
export function pickTaints(rows: Toleration[], offered: ClusterTaint[], picked: string[]): Toleration[] {
  const want = new Set(picked);
  const kept = rows.filter((r) => !offered.some((c) => !want.has(c.taint) && sameToleration(r, c.toleration)));
  const added = offered.filter((c) => want.has(c.taint) && !kept.some((r) => sameToleration(r, c.toleration))).map((c) => ({ ...c.toleration }));
  return [...kept, ...added];
}

export const pickedTaints = (rows: Toleration[], offered: ClusterTaint[]) => offered.filter((c) => rows.some((r) => sameToleration(r, c.toleration))).map((c) => c.taint);
