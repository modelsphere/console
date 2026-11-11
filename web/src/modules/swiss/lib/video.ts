import type { ApplyFlags, Input as CatalogInput, JobSLORequirementSpec, ObjectResult, Plan, PlanRequest } from "@swiss/lib/api";
import { overlay, withPreset } from "@swiss/lib/formLayer";
import { setInputOverrides } from "@swiss/lib/inputs";
import { DEFAULTS, KEYS, POOLS, VIDEO_ENGINE, type Pool } from "@swiss/lib/videoChart";
import { tolerationRow, tolerationValue, type Toleration } from "@swiss/components/DeploySettings";

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

// Number fields are kept as typed; empty leaves the chart's value.
export interface PoolForm {
  enabled: boolean;
  replicaCount: string;
  tpSize: string;
  ulyssesDegree: string;
}

export interface VideoForm {
  serviceId: string;
  namespace: string;
  createNamespace: boolean;
  pools: Record<Pool, PoolForm>;
  turbo: boolean;
  storageClass: string;
  storageSize: string;
  // Never seeded from a plan: an upgrade keeps the release's own unless one is typed.
  databaseUrl: string;
  // The release's form layer already sets database.url, so an empty field keeps it.
  databaseKept: boolean;
  autoscale: boolean;
  modelRoute: boolean;
  route: string;
  inputs: Record<string, string>;
  preset: string;
  tolerations: Toleration[];
  priorityClassName: string;
  schedulerName: string;
  gpuProducts: string[];
  edits: string;
  skipSchemaValidation: boolean;
}

const pool = (): PoolForm => ({
  enabled: true,
  replicaCount: String(DEFAULTS.replicaCount),
  tpSize: String(DEFAULTS.tpSize),
  ulyssesDegree: String(DEFAULTS.ulyssesDegree),
});

export const VIDEO_EMPTY: VideoForm = {
  serviceId: "",
  namespace: "",
  createNamespace: false,
  pools: { fl2va: pool(), ref2va: pool() },
  turbo: DEFAULTS.turbo,
  storageClass: "",
  storageSize: DEFAULTS.storageSize,
  databaseUrl: "",
  databaseKept: false,
  autoscale: false,
  modelRoute: false,
  route: "",
  inputs: {},
  preset: "",
  tolerations: DEFAULTS.tolerations,
  priorityClassName: "",
  schedulerName: "",
  gpuProducts: [],
  edits: "",
  skipSchemaValidation: false,
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

// videoDefaults is a fresh deploy's form: the console's defaults, with what
// the variant's own values set over them, and the site's route switch.
export function videoDefaults(values: Tree | undefined, site?: { modelRoute?: boolean }): VideoForm {
  const on = (path: string, fallback: boolean) => {
    const v = get(values, path);
    return typeof v === "boolean" ? v : fallback;
  };
  return {
    ...VIDEO_EMPTY,
    pools: { fl2va: readPool(values, "fl2va", VIDEO_EMPTY.pools.fl2va), ref2va: readPool(values, "ref2va", VIDEO_EMPTY.pools.ref2va) },
    turbo: on(KEYS.turbo, VIDEO_EMPTY.turbo),
    storageClass: str(get(values, KEYS.storageClass)),
    storageSize: str(get(values, KEYS.storageSize)) || VIDEO_EMPTY.storageSize,
    autoscale: on(KEYS.scaler, false) && on(KEYS.sloRequirement, false),
    modelRoute: on(KEYS.modelRouteEnabled, !!site?.modelRoute),
  };
}

export function podGpus(p: PoolForm): number {
  const tp = num(p.tpSize) ?? DEFAULTS.tpSize;
  const u = num(p.ulyssesDegree) ?? DEFAULTS.ulyssesDegree;
  return tp * u;
}

// videoGpus is what the release asks for at its replica counts.
export function videoGpus(f: VideoForm): { perPod: Record<Pool, number>; total: number } {
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


export type VideoProblem = { code: "serviceId" } | { code: "noPool" };

// videoProblem is why the form cannot be composed, or undefined.
export function videoProblem(f: VideoForm): VideoProblem | undefined {
  if (!f.serviceId.trim()) return { code: "serviceId" };
  if (!POOLS.some((p) => f.pools[p].enabled)) return { code: "noPool" };
  return undefined;
}

// The optional fields an empty box leaves out, and what clears each one: on an
// upgrade the form is laid over the release's form layer, so leaving a key out
// keeps the old value. Not here, so empty means keep: database.url, and the
// shared volume's class and size (an existing PVC's class cannot change and
// its size cannot shrink; an empty size is an invalid PVC).
const CLEARABLE: [path: string, empty: unknown][] = [
  [KEYS.route, ""],
  [KEYS.priorityClassName, ""],
  [KEYS.schedulerName, ""],
  [KEYS.gpuProduct, []],
];

const isSet = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

// videoOverrides is the form layer the form writes. With formLayer, the
// release's, a field emptied here that the release had set is sent cleared.
export function videoOverrides(f: VideoForm, formLayer?: Tree): Tree {
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
  set(out, KEYS.scaler, f.autoscale);
  set(out, KEYS.sloRequirement, f.autoscale);
  if (f.storageClass.trim()) set(out, KEYS.storageClass, f.storageClass.trim());
  if (f.storageSize.trim()) set(out, KEYS.storageSize, f.storageSize.trim());
  if (f.databaseUrl.trim()) set(out, KEYS.databaseUrl, f.databaseUrl.trim());
  set(out, KEYS.modelRouteEnabled, f.modelRoute);
  // Empty is the service ID, which already names the route.
  if (f.modelRoute && f.route.trim()) set(out, KEYS.route, f.route.trim());
  const tolerations = f.tolerations.flatMap((t) => tolerationValue(t) ?? []);
  set(out, KEYS.tolerations, tolerations);
  if (f.priorityClassName.trim()) set(out, KEYS.priorityClassName, f.priorityClassName.trim());
  if (f.schedulerName.trim()) set(out, KEYS.schedulerName, f.schedulerName.trim());
  if (f.gpuProducts.length) set(out, KEYS.gpuProduct, f.gpuProducts);
  for (const [path, empty] of CLEARABLE) {
    if (get(out, path) === undefined && isSet(get(formLayer, path))) set(out, path, empty);
  }
  return out;
}

export function videoPlanRequest(
  f: VideoForm,
  opts: {
    model: string;
    version?: string;
    variant?: string;
    fromRelease?: string;
    catalog?: string;
    chartVersion?: string;
    inputs?: CatalogInput[];
    preset?: Tree;
    formLayer?: Tree;
  },
): PlanRequest {
  const overrides = videoOverrides(f, opts.formLayer);
  setInputOverrides(overrides, opts.inputs, f.inputs);
  const layer = withPreset(opts.formLayer ? overlay(opts.formLayer, overrides) : overrides, opts.preset);
  return {
    catalog: opts.catalog || undefined,
    model: opts.model,
    fromRelease: opts.fromRelease,
    chartVersion: opts.chartVersion || undefined,
    version: opts.version || undefined,
    variant: opts.variant || undefined,
    editsYAML: f.edits.trim() || undefined,
    release: f.serviceId.trim() || undefined,
    namespace: f.namespace.trim() || undefined,
    createNamespace: f.createNamespace || undefined,
    serviceId: f.serviceId.trim() || undefined,
    overrides: layer,
  };
}

export function videoApplyFlags(f: VideoForm): ApplyFlags | undefined {
  const flags: ApplyFlags = {};
  if (f.skipSchemaValidation) flags.skipSchemaValidation = true;
  if (f.createNamespace) flags.createNamespace = true;
  return Object.keys(flags).length ? flags : undefined;
}

// videoFormFromPlan is videoOverrides read back from a release's form layer.
export function videoFormFromPlan(plan: Plan, editsYAML = ""): VideoForm {
  const o = (plan.layers?.form ?? {}) as Tree;
  const on = (path: string, fallback: boolean) => {
    const v = get(o, path);
    return typeof v === "boolean" ? v : fallback;
  };
  const tolerations = get(o, KEYS.tolerations);
  const products = get(o, KEYS.gpuProduct);
  const route = str(get(o, KEYS.route));
  const serviceId = str(get(o, "serviceId")) || plan.release.name;
  // Earlier forms wrote the service ID as the route; it reads back as empty.
  return {
    ...VIDEO_EMPTY,
    serviceId,
    namespace: plan.release.namespace,
    pools: { fl2va: readPool(o, "fl2va", VIDEO_EMPTY.pools.fl2va), ref2va: readPool(o, "ref2va", VIDEO_EMPTY.pools.ref2va) },
    turbo: on(KEYS.turbo, VIDEO_EMPTY.turbo),
    storageClass: str(get(o, KEYS.storageClass)),
    storageSize: str(get(o, KEYS.storageSize)) || VIDEO_EMPTY.storageSize,
    databaseKept: !!str(get(o, KEYS.databaseUrl)),
    autoscale: on(KEYS.scaler, false),
    modelRoute: on(KEYS.modelRouteEnabled, false),
    route: route === serviceId ? "" : route,
    tolerations: Array.isArray(tolerations)
      ? tolerations.filter((t): t is Tree => !!t && typeof t === "object").map(tolerationRow)
      : VIDEO_EMPTY.tolerations,
    priorityClassName: str(get(o, KEYS.priorityClassName)),
    schedulerName: str(get(o, KEYS.schedulerName)),
    gpuProducts: Array.isArray(products) ? products.map(String) : [],
    edits: editsYAML,
  };
}
