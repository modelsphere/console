import type { JobSLORequirementSpec, ObjectResult } from "@swiss/lib/api";
import { DEFAULTS, KEYS, POOLS, VIDEO_ENGINE, type Pool } from "@swiss/lib/videoChart";

export function isVideo(engine: string | undefined): boolean {
  return engine === VIDEO_ENGINE;
}

// The charts the LLM engines (and mock) run on. swissd refuses a video variant
// on one of them, so a release on any other chart is not an LLM.
const LLM_CHARTS = ["sglang", "vllm"];

// isVideoDeployment reads a list row, which carries no plan: the engine when
// swissd sends it, else the chart, "name-version" as helm names it.
export function isVideoDeployment(d: { engine?: string; chart?: string }): boolean {
  if (d.engine) return isVideo(d.engine);
  if (!d.chart) return false;
  const name = d.chart.replace(/-v?\d+\.\d+\.\d+.*$/, "");
  return !LLM_CHARTS.includes(name);
}

export interface JobSLO {
  serviceId: string;
  // The pool, when the service id ends in one; a label only.
  pool?: Pool;
  spec?: JobSLORequirementSpec;
  result: ObjectResult;
}

// jobSLOs is a video release's SLOs, one per pool, as its objects list them.
// The service id is read off each object rather than built from the release
// name: it is the chart's to choose.
export function jobSLOs(objects: ObjectResult[] | undefined): JobSLO[] {
  return (objects ?? [])
    .filter((o) => o.ref.kind === "JobSLORequirement")
    .map((o) => {
      const spec = o.live?.spec as JobSLORequirementSpec | undefined;
      const serviceId = spec?.serviceId || o.ref.name;
      return { serviceId, pool: POOLS.find((p) => serviceId.endsWith(`-${p}`)), spec, result: o };
    })
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

// poolScalers is a video release's LLMScalers, one per pool, and those of the
// pools that are scaled. A pool whose JobSLO has no maximum is not scaled by
// design: the decision server publishes nothing for it, and its scaler reports
// that as unavailable, which is not a failure.
export function poolScalers(objects: ObjectResult[] | undefined): { all: ObjectResult[]; scaled: ObjectResult[] } {
  const ids = new Set(jobSLOs(objects).filter((j) => j.spec?.maximumDeployment).map((j) => j.serviceId));
  const all = (objects ?? []).filter((o) => o.ref.kind === "LLMScaler");
  const scaled = all.filter((o) => ids.has(((o.live?.spec ?? {}) as { customProvider?: { serviceId?: string } }).customProvider?.serviceId ?? ""));
  return { all, scaled };
}

// videoSeed decides what a deploy form does with its video fields when the
// variant (or its values) changes: seed them from a video variant's values,
// merged into what is typed; clear them, GPU tolerations included, on leaving a
// video variant; or nothing. prev is the last key returned (null before any).
export function videoSeed(prev: string | null, video: boolean, values: unknown): { key: string; action?: "seed" | "clear" } {
  const key = video ? JSON.stringify(values ?? null) : "";
  if (prev === key) return { key };
  if (video) return { key, action: "seed" };
  return prev ? { key, action: "clear" } : { key };
}

// Number fields are kept as typed; empty leaves the chart's value.
export interface PoolForm {
  enabled: boolean;
  replicaCount: string;
  tpSize: string;
  ulyssesDegree: string;
}

// VideoFields is what a video deploy asks beyond the LLM form, which it
// otherwise shares (Form.video): the two pools, Turbo, the shared asset volume
// and the job database.
export interface VideoFields {
  pools: Record<Pool, PoolForm>;
  turbo: boolean;
  // Asked here only when the variant does not declare it as an input.
  storageClass: string;
  storageSize: string;
  // Never seeded from a plan: an upgrade keeps the release's own unless one is typed.
  databaseUrl: string;
  // The release's form layer already sets database.url, so an empty field keeps it.
  databaseKept: boolean;
}

const pool = (): PoolForm => ({
  enabled: true,
  replicaCount: String(DEFAULTS.replicaCount),
  tpSize: String(DEFAULTS.tpSize),
  ulyssesDegree: String(DEFAULTS.ulyssesDegree),
});

export const VIDEO_EMPTY: VideoFields = {
  pools: { fl2va: pool(), ref2va: pool() },
  turbo: DEFAULTS.turbo,
  storageClass: "",
  storageSize: DEFAULTS.storageSize,
  databaseUrl: "",
  databaseKept: false,
};

type Tree = Record<string, unknown>;

function get(tree: Tree | undefined, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Tree)[k] : undefined), tree);
}

function set(tree: Tree, path: string, value: unknown) {
  const keys = path.split(".");
  let node = tree;
  for (const k of keys.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object" || Array.isArray(node[k])) node[k] = {};
    node = node[k] as Tree;
  }
  node[keys[keys.length - 1]] = value;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function readPool(tree: Tree | undefined, p: Pool, base: PoolForm): PoolForm {
  const k = KEYS.pool(p);
  const pick = (path: string, fallback: string) => (get(tree, path) === undefined ? fallback : str(get(tree, path)));
  const on = get(tree, k.enabled);
  return {
    enabled: typeof on === "boolean" ? on : base.enabled,
    replicaCount: pick(k.replicaCount, base.replicaCount),
    tpSize: pick(k.tpSize, base.tpSize),
    ulyssesDegree: pick(k.ulyssesDegree, base.ulyssesDegree),
  };
}

// videoFields reads the video part of a tree: the variant's values on a fresh
// deploy (over the console's defaults), a release's form layer on an upgrade.
// A release's size the form layer does not set stays empty, which keeps the
// volume as it is: the default could be smaller, and a PVC cannot shrink.
export function videoFields(tree: Tree | undefined, opts: { release?: boolean } = {}): VideoFields {
  const turbo = get(tree, KEYS.turbo);
  return {
    pools: { fl2va: readPool(tree, "fl2va", VIDEO_EMPTY.pools.fl2va), ref2va: readPool(tree, "ref2va", VIDEO_EMPTY.pools.ref2va) },
    turbo: typeof turbo === "boolean" ? turbo : VIDEO_EMPTY.turbo,
    storageClass: str(get(tree, KEYS.storageClass)),
    storageSize: str(get(tree, KEYS.storageSize)) || (opts.release ? "" : VIDEO_EMPTY.storageSize),
    databaseUrl: "",
    databaseKept: !!str(get(tree, KEYS.databaseUrl)),
  };
}

export function podGpus(p: PoolForm): number {
  const tp = num(p.tpSize) ?? DEFAULTS.tpSize;
  const u = num(p.ulyssesDegree) ?? DEFAULTS.ulyssesDegree;
  return tp * u;
}

// videoGpus is what the release asks for at its replica counts.
export function videoGpus(f: VideoFields): { perPod: Record<Pool, number>; total: number } {
  const perPod = { fl2va: podGpus(f.pools.fl2va), ref2va: podGpus(f.pools.ref2va) };
  let total = 0;
  for (const p of POOLS) {
    const pf = f.pools[p];
    if (!pf.enabled) continue;
    const replicas = num(pf.replicaCount) ?? DEFAULTS.replicaCount;
    total += perPod[p] * replicas;
  }
  return { perPod, total };
}

export type VideoProblem = { code: "noPool" } | { code: "zero" };

// videoProblem is why the video part cannot be composed, or undefined. An
// enabled pool with 0 replicas, TP or Ulysses is refused here rather than at
// render: the GPU count would be 0 and the engine args invalid.
export function videoProblem(f: VideoFields): VideoProblem | undefined {
  if (!POOLS.some((p) => f.pools[p].enabled)) return { code: "noPool" };
  for (const p of POOLS) {
    const pf = f.pools[p];
    if (pf.enabled && [pf.replicaCount, pf.tpSize, pf.ulyssesDegree].some((v) => num(v) === 0)) return { code: "zero" };
  }
  return undefined;
}

// Scheduling keys under sglang.* that earlier video forms wrote. The form now
// writes the top-level keys an LLM deploy writes, which the chart reads for the
// GPU pods -- but an sglang.* value would still win, so an upgrade clears them.
const LEGACY: [path: string, empty: unknown][] = [
  ["sglang.priorityClassName", ""],
  ["sglang.schedulerName", ""],
  ["sglang.gpuProduct", []],
];

const isSet = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

// videoOverrides is the video part of the form layer. Empty keeps, for the
// database URL and the shared volume: an existing PVC's class cannot change,
// its size cannot shrink, and an empty size is an invalid PVC.
export function videoOverrides(f: VideoFields, formLayer?: Tree): Tree {
  const out: Tree = {};
  // Every switch is written, so no decision is left to a chart default.
  for (const p of POOLS) {
    const k = KEYS.pool(p);
    const pf = f.pools[p];
    set(out, k.enabled, pf.enabled);
    if (!pf.enabled) continue;
    for (const [field, key] of [["replicaCount", k.replicaCount], ["tpSize", k.tpSize], ["ulyssesDegree", k.ulyssesDegree]] as const) {
      const v = num(pf[field]);
      if (v !== undefined) set(out, key, v);
    }
    set(out, k.gpuCount, podGpus(pf));
  }
  if (f.pools.ref2va.enabled) set(out, KEYS.turbo, f.turbo);
  if (f.storageClass.trim()) set(out, KEYS.storageClass, f.storageClass.trim());
  if (f.storageSize.trim()) set(out, KEYS.storageSize, f.storageSize.trim());
  if (f.databaseUrl.trim()) set(out, KEYS.databaseUrl, f.databaseUrl.trim());
  for (const [path, empty] of LEGACY) {
    if (isSet(get(formLayer, path))) set(out, path, empty);
  }
  return out;
}
