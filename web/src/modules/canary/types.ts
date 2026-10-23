import type { CANARY_API_VERSION } from "./lib/kubernetes";

/** JSON-ish object used for chart values and layer documents. */
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Phase = "Idle" | "Provisioning" | "Serving" | "Draining" | "Failed";

export interface ChartRef {
  repository?: string;
  name: string;
  version: string;
}

export interface TargetRef {
  kind: string;
  name: string;
  namespace?: string;
}

/** Optional catalog lineage on an arm. UI-only until the CRD field lands. */
export interface ArmSource {
  catalog?: string;
  model: string;
  version: string;
  digest?: string;
  variant: string;
  hf?: string;
}

export interface ArmSpec {
  name: string;
  chart: ChartRef;
  values: JsonObject;
  source?: ArmSource;
}

export interface Condition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface LLMCanarySpec {
  targetRef: TargetRef;
  inheritValues?: boolean;
  arms: ArmSpec[];
  proxy?: {
    mode?: "PerArm" | "Shared";
    chart?: ChartRef;
    values?: JsonObject;
    replicas?: number;
    sessionAffinity?: boolean;
  };
  traffic: { production: number; canary: number };
  gateway: {
    name: string;
    namespace: string;
    hostname?: string;
    sectionName?: string;
  };
  route: {
    enabled?: boolean;
    productionOpenrestyService: string;
    path?: string;
    servicePort?: number;
    forceHeader?: { name: string; value: string };
  };
  guardrails?: {
    maxExperimentalRestarts?: number;
    readinessGracePeriod?: string;
    requireBaselineHealthy?: boolean;
  };
  drain?: { maxWait?: string };
}

export interface LLMCanaryStatus {
  phase?: Phase;
  observedGeneration?: number;
  armsReadySince?: string;
  arms?: { name: string; ready?: boolean }[];
  canaryProxy?: { name: string; arm?: string; ready?: boolean };
  canaryProxies?: { name: string; arm?: string; ready?: boolean }[];
  routeName?: string;
  routePath?: string;
  gatewayNamespace?: string;
  drainStartedAt?: string;
  drainInFlight?: number;
  conditions?: Condition[];
}

export interface LLMCanary {
  apiVersion: typeof CANARY_API_VERSION;
  kind: "LLMCanary";
  metadata: {
    name: string;
    namespace: string;
    generation?: number;
    uid?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec: LLMCanarySpec;
  status?: LLMCanaryStatus;
}

export interface CatalogRequires {
  gpus: number;
  nodes?: number;
  topology?: "single-node" | "lws";
  gpuProduct?: string[];
  vendor?: string;
  rdma?: boolean;
}

export interface CatalogImage {
  repository: string;
  tag: string;
  digest?: string;
}

/** One catalog.swiss/v2 Variant file, already resolved for the UI. */
export interface CatalogVariant {
  apiVersion: "catalog.swiss/v2";
  kind: "Variant";
  model: string;
  id: string;
  version: string;
  servedName?: string;
  description?: string;
  engine: "sglang" | "vllm";
  chart: { name: "sglang" | "vllm"; version: string };
  /** Exact chart version pinned for the LLMCanary CR (catalog ranges are not allowed on arms). */
  resolvedChartVersion: string;
  image?: CatalogImage;
  requires: CatalogRequires;
  values: JsonObject;
  digest?: string;
  path?: string;
  deprecated?: boolean | string;
}

/** Swiss versions permitted by one specific catalog variant revision, newest first. */
export interface ChartVersions {
  chart: string;
  range: string;
  variant: string;
  versions: string[];
}

export type ChartVersionsSource = Pick<ArmSource, "catalog" | "model" | "variant" | "version">;

export interface CatalogIndexVariant {
  id: string;
  version: string;
  digest: string;
  engine: string;
  chart: { name: string; version: string };
  requires: CatalogRequires;
  servedName?: string;
  description?: string;
  default?: boolean;
  deprecated?: boolean | string;
  replaces?: string;
  link?: string;
}

export interface CatalogIndexModel {
  name: string;
  displayName?: string;
  description?: string;
  family?: string;
  tags?: string[];
  defaultVariant?: string;
  source?: { hf?: string; revision?: string; sizeGiB?: number };
  tuning?: {
    baseline: { id: string; version?: string };
    optimized: { id: string; version?: string };
    uplift?: number;
    report?: string;
  }[];
  variants: CatalogIndexVariant[];
}

/** Swiss's schema-v2 catalog listing, not the raw repository index. */
export interface CatalogIndexV2 {
  schema: "v2";
  name: string;
  ref?: string;
  source?: string;
  site?: string;
  models: CatalogIndexModel[];
}

export interface ProductionTarget {
  kind: "HelmRelease";
  name: string;
  namespace: string;
  model?: string;
  variant?: string;
  version?: string;
  /** Production route key. The wizard writes it as spec.route.path (`/` + route). */
  route?: string;
  chart?: string;
  /** Gateway this production path attaches to. The wizard copies it into spec.gateway. */
  gateway?: {
    name: string;
    namespace: string;
    hostname?: string;
    sectionName?: string;
  };
  /** Production openresty Service in the Gateway namespace. */
  openrestyService?: string;
}

export const LAYER_ORDER = [
  "defaults",
  "catalog",
  "site",
  "derived",
  "form",
  "edit",
] as const;
export type LayerName = (typeof LAYER_ORDER)[number];

export type LayerDocuments = Partial<Record<LayerName, JsonObject>>;

export interface ArmDraft {
  pricingKey?: string;
  gpuCount?: number;
  name: string;
  source?: ArmSource;
  chart: ChartRef;
  layers: LayerDocuments;
  replicaCount: number;
}

export interface CanaryDraft {
  compareArms?: string[];
  name: string;
  namespace: string;
  targetRef: TargetRef;
  arms: ArmDraft[];
  traffic: { production: number; canary: number };
  gateway: {
    name: string;
    namespace: string;
    hostname?: string;
    sectionName?: string;
  };
  route: {
    enabled: boolean;
    productionOpenrestyService: string;
    path?: string;
    servicePort?: number;
    forceHeader: { name: string; value: string };
  };
  proxy: {
    mode: "PerArm";
    replicas: number;
    sessionAffinity: boolean;
    values?: JsonObject;
  };
}

export interface Prepared {
  economics?: Economics;
  id: string;
  createdAt: string;
  draft: CanaryDraft;
  canary: LLMCanary;
  plans: JsonObject[];
  warnings: string[];
}
export interface TrafficChange {
  id: string;
  from: { production: number; canary: number };
  to: { production: number; canary: number };
  requestedAt: string;
  requestedBy: string;
  expectedGeneration: number;
  generation?: number;
  appliedAt?: string;
  status: "pending" | "applying" | "applied" | "failed" | "cancelled";
  error?: string;
}

export interface Experiment {
  trafficChanges?: TrafficChange[];
  id: string;
  prepareId: string;
  uid?: string;
  name: string;
  namespace: string;
  creator: string;
  createdAt: string;
  canary: LLMCanary;
  prepared: Prepared;
  compareArms: string[];
  state: "Creating" | "Running" | "Stopping" | "Stopped";
  archived: boolean;
  stopAt?: string;
  cleanup: "pending" | "complete";
  snapshot: "pending" | "failed" | "complete";
  snapshotError?: string;
  error?: string;
  windows: {
    traffic?: { production: number; canary: number };
    start: string;
    end: string;
    generation: number;
    bindings: Record<
      string,
      { namespace: string; service: string; uid: string }
    >;
  }[];
}
export type ExperimentSummary = Pick<
  Experiment,
  | "id"
  | "name"
  | "namespace"
  | "creator"
  | "createdAt"
  | "state"
  | "archived"
  | "cleanup"
  | "snapshot"
  | "snapshotError"
  | "error"
  | "compareArms"
> & { targetRef: TargetRef; phase?: Phase };

export interface MetricSummary {
  inputTokens?: number | null;
  cachedTokens?: number | null;
  outputTokens?: number | null;
  ttftMean?: number | null;
  ttftP50?: number | null;
  ttftP99?: number | null;
  ttftP999?: number | null;
  uncachedTPM: number | null;
  revenueInputPerMinute: number | null;
  revenueCachedPerMinute: number | null;
  revenueOutputPerMinute: number | null;
  revenuePerMinute: number | null;
  revenuePerHour: number | null;
  cacheHit: number | null;
  inputTPM: number | null;
  cachedTPM: number | null;
  outputTPM: number | null;
  totalTPM: number | null;
  ttftP95: number | null;
  overallTPS: number | null;
  decodeTPS: number | null;
  requests: number | null;
  ttftSamples: number | null;
  completeMinutes: number;
}
export interface Metrics {
  windows?: Experiment["windows"];
  resolutionSeconds?: number;
  lastCollectedAt?: string | null;
  range?: {
    start: number;
    end: number;
    intersections: [number, number][];
    dataStart: number | null;
    dataEnd: number | null;
  };
  economics?: Economics | null;
  valuation: ValuationView;
  experimentId: string;
  compareArms: string[];
  eligibleMinutes: number;
  excludedMinutes?: number;
  series: {
    time: number;
    arms: Record<string, MetricSummary>;
    error?: string;
  }[];
  summary: Record<string, MetricSummary>;
  delta: MetricSummary;
  snapshot: string;
  snapshotError?: string;
}

export type Currency = "USD" | "CNY";
export interface TokenPrices {
  inputPerMillion: number;
  cachedPerMillion: number;
  outputPerMillion: number;
}
export type ModelPrices = Record<Currency, TokenPrices | null>;
export interface PricingTable {
  revision: number;
  currency: Currency;
  default: ModelPrices;
  models: Record<string, ModelPrices>;
  updatedAt?: string;
  updatedBy?: string;
}
export interface ArmEconomics {
  model: string;
  pricingKey: string;
  resolution: "exact" | "default" | "missing";
  prices: ModelPrices;
  gpuCount: number | null;
  gpuSource: "manual" | "helm-values" | "unknown";
}
export interface Economics {
  revision: number;
  pricingRevision: number;
  currency: Currency;
  frozenAt: string;
  frozenBy: string;
  arms: Record<string, ArmEconomics>;
}
export interface ValuationView {
  currency?: Currency;
  normalization: "raw" | "per-gpu" | "as-if";
  targetGPUs?: number;
}
