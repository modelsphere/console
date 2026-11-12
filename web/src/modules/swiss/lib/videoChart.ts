// Every chart value key and default the video part of the deploy form writes or assumes,
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
    // GPUs per pod. The chart takes it over model.gpus (the variant's
    // requires.gpus) and refuses a render where it is not tp × ulysses.
    gpuCount: `pools.${p}.sglang.gpuCount`,
  }),
  turbo: "pools.ref2va.turbo.enabled",
  storageClass: "sharedStorage.storageClass",
  storageSize: "sharedStorage.size",
  databaseUrl: "database.url",
  // The LLM form's SLO switch writes both, as it does for an LLM. The chart then
  // gives each pool a JobSLORequirement with no maximum, which is not scaled
  // until the SLO card sets one; the deploy form writes no per-pool SLO keys.
  scaler: "scaler.enabled",
  sloRequirement: "sloRequirement.enabled",
  // The GPU pods' tolerations. The chart has no top-level tolerations (the
  // router runs on any node), so this one key differs from an LLM deploy's;
  // priorityClassName, schedulerName and affinity are the top-level keys an
  // LLM deploy writes, which the chart takes for the GPU pods.
  tolerations: "sglang.tolerations",
} as const;

export const DEFAULTS = {
  replicaCount: 1,
  tpSize: 4,
  ulyssesDegree: 1,
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
