import { Link, Route, Routes } from "react-router";
import { DeploymentDetail } from "@swiss/routes/DeploymentDetail";
import type { ObjectResult, ReleaseStatus } from "@swiss/lib/api";

// Dev-only: the release page against canned swissd answers, so the install
// status track and the cluster resource panels can be looked at in each state
// without a cluster. Only the endpoints the page calls are stubbed.
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const route = (ready: boolean, backends: number, extra: Record<string, unknown> = {}): ObjectResult => ({
  ref: { apiVersion: "routing.modelsphere.dev/v1alpha1", kind: "ModelRoute", namespace: "models", name: "glm-53" },
  live: {
    generation: 3,
    spec: {
      modelType: "llm",
      discovery: { service: "glm-53-leader", port: 30000 },
      nginx: {
        route: "glm-53",
        outputConfigMap: "llm-route/openresty-conf",
        peers: [
          { use: "cart", priority: 1, maxConcurrencyFromBackend: true },
          { use: "backend", priority: 0, maxConcurrency: 64 },
          { use: "backend-svc", priority: -1 },
        ],
        values: { ttft_limit_ms: "8000", adaptive_cc_min: "4" },
      },
      cart: { service: "glm-53-cart", outputConfigMap: "models/glm-53-cart", maxLoad: 20 },
      slo: { name: "glm-53" },
    },
    status: {
      ready,
      backends,
      cartPeers: 2,
      lastSyncTime: ago(1),
      observedGeneration: 3,
      conditions: [
        {
          type: "Synced",
          status: ready ? "True" : "False",
          reason: ready ? "PeersWritten" : "NoBackends",
          message: ready ? "" : "EndpointSlice glm-53-leader has no ready endpoints",
          lastTransitionTime: ago(ready ? 42 : 3),
        },
      ],
      ...extra,
    },
  },
});

const scaler = (current: number, desired: number, failing = false): ObjectResult => ({
  ref: { apiVersion: "autoscaling.modelsphere.dev/v1alpha1", kind: "LLMScaler", namespace: "models", name: "glm-53" },
  live: {
    generation: 1,
    spec: {
      targetRef: { apiVersion: "leaderworkerset.x-k8s.io/v1", kind: "LeaderWorkerSet", name: "glm-53" },
      metricProvider: "Prometheus",
      serverAddress: "http://prometheus-operated.monitoring.svc:9090",
      minReplicas: 1,
      maxReplicas: 6,
      syncPeriodSeconds: 30,
      metrics: [
        {
          name: "kv cache",
          query: 'avg(sglang:token_usage{namespace="models", app="glm-53-sglang"})',
          target: "0.75",
        },
      ],
      scaleDown: { behavior: "CacheAware", maxStepReplicas: 1, stabilizationWindowSeconds: 300 },
    },
    status: {
      currentReplicas: current,
      desiredReplicas: desired,
      conditions: [
        failing
          ? {
              type: "ScalingActive",
              status: "False",
              reason: "MetricUnavailable",
              message: "query returned no data for 5 consecutive syncs",
              lastTransitionTime: ago(6),
            }
          : { type: "ScalingActive", status: "True", reason: "Synced", lastTransitionTime: ago(120) },
      ],
    },
  },
});

const slo: ObjectResult = {
  ref: { apiVersion: "inference.modelsphere.dev/v1alpha1", kind: "LLMSLORequirement", namespace: "models", name: "glm-53" },
  live: {
    generation: 2,
    spec: {
      serviceId: "glm-53",
      priority: 10,
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 6 },
      ttft: {
        default: { metrics: [{ type: "p80", threshold: 2 }, { type: "p95", threshold: 4 }] },
        ranges: [{ contextLengthRangeLow: 32768, contextLengthRangeHigh: 131072, metrics: [{ type: "p95", threshold: 12 }] }],
      },
      otps: { default: { metrics: [{ type: "p80", threshold: 30 }] } },
    },
  },
};

const status = (ready: number, total: number, phase: string, extra: Partial<ReleaseStatus> = {}): ReleaseStatus => ({
  release: "glm-53",
  namespace: "models",
  exists: true,
  revision: 4,
  helmStatus: phase === "failed" ? "failed" : "deployed",
  ready,
  total,
  route: "glm-53",
  url: "https://llm.example.com/glm-53",
  model: "glm",
  authPrefix: "Bearer ",
  pods: Array.from({ length: total }, (_, i) => ({
    name: `glm-53-${i}`,
    phase: "Running",
    ready: i < ready,
    restarts: 0,
    node: `h100-0${i + 1}`,
    ageSeconds: 7200,
  })),
  planStatus: {
    phase,
    action: "upgrade",
    revision: 4,
    startedAt: ago(48),
    updatedAt: ago(44),
    note: "bump sglang to v0.5.19 for the EAGLE fix",
    ...(phase === "failed" ? { error: "UPGRADE FAILED: context deadline exceeded" } : {}),
  },
  ...extra,
});

const CASES: Record<string, { status: ReleaseStatus; objects: ObjectResult[] }> = {
  healthy: { status: status(2, 2, "applied"), objects: [route(true, 2), scaler(2, 2), slo] },
  scaling: { status: status(2, 3, "applied"), objects: [route(true, 2), scaler(2, 3), slo] },
  broken: {
    status: status(0, 2, "failed"),
    objects: [
      route(false, 0, { orphanRouteKeys: ["llm-route/openresty-conf:session_route_glm-5.conf"] }),
      scaler(2, 2, true),
      { ...slo, live: undefined, error: "swissd may not read LLMSLORequirement in models: upgrade the swiss chart, which grants it" },
    ],
  },
  bare: { status: status(1, 1, "applied"), objects: [] },
};

function installStub() {
  if (!import.meta.env.DEV || Reflect.get(window, "__releaseStub")) return;
  Reflect.set(window, "__releaseStub", true);
  const real = window.fetch.bind(window);
  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/cluster")) return json({ name: "preview", allowDeploy: false });
    const m = url.match(/\/api\/releases\/models\/(healthy|scaling|broken|bare)\/(status|objects|plan)$/);
    if (!m) return real(input, init);
    const c = CASES[m[1]];
    if (m[2] === "status") return json({ ...c.status, release: m[1] });
    if (m[2] === "objects") return json({ objects: c.objects });
    return json({ error: "no plan" }, 404);
  };
}

export function PreviewRelease() {
  installStub();
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <nav className="flex gap-3 text-sm">
        {Object.keys(CASES).map((k) => (
          <Link key={k} to={`/preview/release/models/${k}`} className="underline-offset-2 hover:underline">
            {k}
          </Link>
        ))}
      </nav>
      <Routes>
        <Route path=":namespace/:release" element={<DeploymentDetail />} />
      </Routes>
    </div>
  );
}
