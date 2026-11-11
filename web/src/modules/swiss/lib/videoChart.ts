// Every chart value key and default the video deploy form writes or assumes,
// in one place so they follow the video chart (minimax-h3) when it renames one.
// Nothing else in the console spells these paths.

export const VIDEO_ENGINE = "video";

export const POOLS = ["fl2va", "ref2va"] as const;
export type Pool = (typeof POOLS)[number];

export const POOL_LABELS: Record<Pool, { title: string; note: string }> = {
  fl2va: { title: "FL2VA", note: "text and first/last frame to video" },
  ref2va: { title: "Ref2VA", note: "reference images, video and audio to video" },
};

export const KEYS = {
  pool: (p: Pool) => ({
    enabled: `pools.${p}.enabled`,
    replicaCount: `pools.${p}.replicaCount`,
    tpSize: `pools.${p}.sglang.args.tpSize`,
    ulyssesDegree: `pools.${p}.sglang.args.ulyssesDegree`,
    // The pool's JobSLORequirement. No maxReplicas is the pool not scaled. The
    // pool's LLMScaler bounds (pools.<p>.scaler.*) are backstops and keep the chart's.
    autoscaleMin: `pools.${p}.sloRequirement.minReplicas`,
    autoscaleMax: `pools.${p}.sloRequirement.maxReplicas`,
    autoscaleMaxDepth: `pools.${p}.sloRequirement.queue.maxDepth`,
  }),
  turbo: "pools.ref2va.turbo.enabled",
  storageClass: "sharedStorage.storageClass",
  storageSize: "sharedStorage.size",
  databaseUrl: "database.url",
  // One "Autoscale" switch turns both on or off.
  scaler: "scaler.enabled",
  sloRequirement: "sloRequirement.enabled",
  modelRouteEnabled: "modelRoute.enabled",
  // Written only when typed: the chart and swissd both fall back to serviceId.
  route: "modelRoute.nginx.route",
  // Scheduling of the GPU pods, which the chart reads over the top-level keys;
  // the router and a CPU-only server keep their own.
  tolerations: "sglang.tolerations",
  priorityClassName: "sglang.priorityClassName",
  schedulerName: "sglang.schedulerName",
  gpuProduct: "sglang.gpuProduct",
} as const;

export const DEFAULTS = {
  replicaCount: 1,
  tpSize: 4,
  ulyssesDegree: 1,
  autoscaleMin: 1,
  autoscaleMaxDepth: { fl2va: 5, ref2va: 2 } as Record<Pool, number>,
  turbo: true,
  storageSize: "500Gi",
  // The chart's own sglang.tolerations. The form sends the whole list, which
  // replaces the chart's, so it starts from it.
  tolerations: [{ key: "nvidia.com/gpu", operator: "Exists" as const, value: "", effect: "NoSchedule" }],
};

// The model name every H3 request carries, whatever the release is called.
export const API_MODEL = "MiniMax-H3";

// The job API, relative to the route's URL.
export const API_PATHS = {
  submit: "/v2/video_generation",
  query: (task: string) => `/v2/query/video_generation/${task}`,
  // Public on the route by default: the URL goes to end users, whose players send no key.
  content: (task: string) => `/v2/video_generation/${task}/content`,
};
