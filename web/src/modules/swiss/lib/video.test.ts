import { describe, expect, it } from "vitest";
import type { ObjectResult, Plan } from "@swiss/lib/api";
import { EMPTY, formFromPlan, planRequest, videoForm, type Form } from "@swiss/components/DeploySettings";
import { isVideoDeployment, poolScalers, VIDEO_EMPTY, videoFields, videoGpus, videoOverrides, videoProblem, videoSeed, type VideoFields } from "./video";

const fields = (patch: Partial<VideoFields> = {}): VideoFields => ({ ...VIDEO_EMPTY, ...patch });
const withPool = (f: VideoFields, p: "fl2va" | "ref2va", patch: Partial<VideoFields["pools"]["fl2va"]>): VideoFields => ({
  ...f,
  pools: { ...f.pools, [p]: { ...f.pools[p], ...patch } },
});
const form = (patch: Partial<Form> = {}): Form => ({ ...videoForm({ ...EMPTY, serviceId: "h3" }, undefined), ...patch });
const request = (f: Form, opts: Partial<Parameters<typeof planRequest>[1]> = {}) => planRequest(f, { model: "minimax-h3", video: true, ...opts });
type Tree = Record<string, Record<string, unknown>>;

describe("videoOverrides", () => {
  it("writes both pools, turbo and the shared volume's size", () => {
    expect(videoOverrides(fields())).toEqual({
      pools: {
        fl2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 }, gpuCount: 4 } },
        ref2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 }, gpuCount: 4 }, turbo: { enabled: true } },
      },
      sharedStorage: { size: "500Gi" },
    });
  });

  it("writes each pool's GPU count as tp × ulysses, which the chart checks against the args", () => {
    const o = videoOverrides(withPool(withPool(fields(), "fl2va", { tpSize: "2", ulyssesDegree: "1" }), "ref2va", { tpSize: "2", ulyssesDegree: "4" })) as { pools: Record<string, { sglang: Record<string, unknown> }> };
    expect(o.pools.fl2va.sglang.gpuCount).toBe(2);
    expect(o.pools.ref2va.sglang.gpuCount).toBe(8);
    expect((videoOverrides(withPool(fields(), "fl2va", { tpSize: "", ulyssesDegree: "" })) as { pools: Record<string, { sglang: Record<string, unknown> }> }).pools.fl2va.sglang).toEqual({ gpuCount: 4 });
  });

  it("writes only enabled: false for a disabled pool, and no turbo without ref2va", () => {
    const o = videoOverrides(withPool(fields(), "ref2va", { enabled: false })) as { pools: Record<string, unknown> };
    expect(o.pools.ref2va).toEqual({ enabled: false });
  });

  it("sends the database URL and storage class only when given; empty keeps the release's", () => {
    const o = videoOverrides(fields({ databaseUrl: " postgresql://u:p@db/x ", storageClass: "cephfs" })) as Tree;
    expect(o.database).toEqual({ url: "postgresql://u:p@db/x" });
    expect(o.sharedStorage).toEqual({ storageClass: "cephfs", size: "500Gi" });
    const kept = videoOverrides(fields({ storageSize: "" }), { sharedStorage: { storageClass: "cephfs", size: "1Ti" }, database: { url: "x" } }) as Tree;
    expect(kept.sharedStorage).toBeUndefined();
    expect(kept.database).toBeUndefined();
  });

  it("clears the sglang.* scheduling keys earlier forms wrote, so the top-level ones apply", () => {
    const layer = { sglang: { priorityClassName: "inference", schedulerName: "volcano", gpuProduct: ["H100"], tolerations: [] } };
    expect((videoOverrides(fields(), layer) as Tree).sglang).toEqual({ priorityClassName: "", schedulerName: "", gpuProduct: [] });
    expect(videoOverrides(fields(), {})).not.toHaveProperty("sglang");
  });
});

describe("planRequest for a video variant", () => {
  it("writes the LLM form's shared keys and the video chart's own, and nothing only an LLM chart takes", () => {
    const req = request(form({ slo: true, modelRoute: true, route: "video", namespace: "video", priorityClassName: "inference", schedulerName: "volcano", gpuProducts: ["NVIDIA-H800"], localPath: "/m/h3", edits: "a: 1" }));
    const o = req.overrides as Tree;
    expect(o.scaler).toEqual({ enabled: true });
    expect(o.sloRequirement).toEqual({ enabled: true });
    expect(o.modelRoute).toEqual({ enabled: true, nginx: { route: "video" } });
    expect(o.priorityClassName).toBe("inference");
    expect(o.schedulerName).toBe("volcano");
    // The chart has no top-level tolerations: the GPU pods' are under sglang, the chart's default first.
    expect(o.sglang).toEqual({ tolerations: [{ key: "nvidia.com/gpu", operator: "Exists", effect: "NoSchedule" }] });
    expect(o.pools).toBeDefined();
    for (const k of ["cart", "cache", "replicaCount", "image", "serviceMonitor", "tolerations"]) expect(o).not.toHaveProperty(k);
    expect(Object.keys(o.modelRoute)).not.toContain("monitor");
    expect(req).toMatchObject({ model: "minimax-h3", release: "h3", serviceId: "h3", namespace: "video", editsYAML: "a: 1", gpuProducts: ["NVIDIA-H800"], localPath: "/m/h3" });
  });

  it("writes the route off with no name, and the SLO switch off as both off", () => {
    const o = request(form({ slo: false, modelRoute: false, route: "" })).overrides as Tree;
    expect(o.modelRoute).toEqual({ enabled: false });
    expect(o.scaler).toEqual({ enabled: false });
    expect(o.sloRequirement).toEqual({ enabled: false });
  });

  it("lays the form over a release's layer and a preset", () => {
    const req = request(form(), { preset: { sglang: { nodeSelector: { pool: "gpu" } } }, formLayer: { database: { url: "kept" } } });
    expect(req.overrides).toMatchObject({ database: { url: "kept" }, sglang: { nodeSelector: { pool: "gpu" } } });
  });
});

describe("videoGpus and videoProblem", () => {
  it("counts the enabled pools at their replicas", () => {
    const f = withPool(fields(), "fl2va", { replicaCount: "2" });
    expect(videoGpus(f)).toEqual({ perPod: { fl2va: 4, ref2va: 4 }, total: 12 });
    expect(videoGpus(withPool(f, "ref2va", { enabled: false })).total).toBe(8);
  });

  it("needs a pool", () => {
    expect(videoProblem(withPool(withPool(fields(), "fl2va", { enabled: false }), "ref2va", { enabled: false }))).toEqual({ code: "noPool" });
    expect(videoProblem(fields())).toBeUndefined();
  });
});

describe("videoFields and formFromPlan", () => {
  it("starts from the variant's values over the console's defaults", () => {
    const f = videoFields({ pools: { fl2va: { replicaCount: 3 }, ref2va: { enabled: false } } });
    expect(f.pools.fl2va.replicaCount).toBe("3");
    expect(f.pools.ref2va.enabled).toBe(false);
  });

  it("round-trips a video release's form layer, and never reads the database URL back", () => {
    const f = form({ slo: true, modelRoute: true, route: "video", priorityClassName: "inference", video: withPool(fields({ databaseUrl: "postgresql://secret", storageClass: "cephfs", turbo: false }), "fl2va", { replicaCount: "2" }) });
    const layer = request(f).overrides;
    const plan = { release: { name: "h3", namespace: "video" }, engine: "video", layers: { form: layer } } as unknown as Plan;
    const back = formFromPlan(plan);
    expect(back.video.databaseUrl).toBe("");
    expect(back.video.databaseKept).toBe(true);
    expect(back.slo).toBe(true);
    expect(back.priorityClassName).toBe("inference");
    expect(request({ ...back, video: { ...back.video, databaseUrl: "postgresql://secret" } }).overrides).toEqual(request({ ...f, namespace: "video" }).overrides);
  });

  it("reads what a release's shared volume is now from every layer, for the empty upgrade fields", () => {
    const plan = { release: { name: "h3", namespace: "video" }, engine: "video", layers: { derived: { sharedStorage: { storageClass: "ceph-filesystem" } }, form: { serviceId: "h3" } } } as unknown as Plan;
    const back = formFromPlan(plan);
    expect(back.video.current).toEqual({ storageSize: "500Gi", storageClass: "ceph-filesystem" });
    expect(back.video.storageSize).toBe("");
    // Display only: nothing of it is written.
    expect(JSON.stringify(request(back).overrides)).not.toContain("ceph-filesystem");
  });

  it("reads an earlier form's sglang.* scheduling keys and a route equal to the service ID", () => {
    const plan = {
      release: { name: "h3", namespace: "video" },
      engine: "video",
      layers: { form: { serviceId: "h3", modelRoute: { enabled: true, nginx: { route: "h3" } }, sglang: { priorityClassName: "p", schedulerName: "s", gpuProduct: ["H100"] } } },
    } as unknown as Plan;
    const back = formFromPlan(plan);
    expect(back).toMatchObject({ priorityClassName: "p", schedulerName: "s", gpuProducts: ["H100"], route: "" });
  });
});

describe("isVideoDeployment", () => {
  it("takes the engine when sent, else any chart that is not an LLM engine chart", () => {
    expect(isVideoDeployment({ engine: "video", chart: "sglang-0.8.0" })).toBe(true);
    expect(isVideoDeployment({ engine: "sglang", chart: "minimax-h3-0.3.0" })).toBe(false);
    expect(isVideoDeployment({ chart: "minimax-h3-0.3.0" })).toBe(true);
    expect(isVideoDeployment({ chart: "sglang-0.8.6" })).toBe(false);
    expect(isVideoDeployment({ chart: "vllm-0.2.0-rc1" })).toBe(false);
    expect(isVideoDeployment({})).toBe(false);
  });
});

describe("formFromPlan when the form layer does not name a switch", () => {
  const plan = (engine: string, layers: Record<string, unknown>) => ({ release: { name: "r", namespace: "ns" }, engine, layers }) as unknown as Plan;

  it("reads an LLM release's switches from the last layer that sets them", () => {
    const f = formFromPlan(plan("sglang", { defaults: { scaler: { enabled: true }, serviceMonitor: { enabled: true } }, site: { modelRoute: { enabled: true } }, form: { serviceId: "r" } }));
    expect(f).toMatchObject({ modelRoute: true, scaler: true, serviceMonitor: true });
    // The form layer, when it names one, is what the operator chose.
    expect(formFromPlan(plan("sglang", { site: { modelRoute: { enabled: true } }, form: { modelRoute: { enabled: false } } })).modelRoute).toBe(false);
    // No layer: the fallback as before.
    expect(formFromPlan(plan("sglang", { form: {} }))).toMatchObject({ modelRoute: false, scaler: false, slo: true, cart: true });
  });

  it("reads a video release's route and SLO the same way", () => {
    const f = formFromPlan(plan("video", { defaults: { scaler: { enabled: true } }, site: { modelRoute: { enabled: true } }, form: { serviceId: "r" } }));
    expect(f).toMatchObject({ modelRoute: true, slo: true });
    expect(formFromPlan(plan("video", { form: { serviceId: "r" } }))).toMatchObject({ modelRoute: false, slo: false });
  });
});

describe("an upgrade's shared volume size", () => {
  it("stays empty when the release's form layer has none, so the request keeps the volume", () => {
    const p = { release: { name: "h3", namespace: "v" }, engine: "video", layers: { form: { serviceId: "h3" } } } as unknown as Plan;
    const f = formFromPlan(p);
    expect(f.video.storageSize).toBe("");
    const o = request(f, { formLayer: { serviceId: "h3" } }).overrides as Tree;
    expect(o.sharedStorage).toBeUndefined();
    // A fresh deploy still starts from the default.
    expect(videoFields(undefined).storageSize).toBe("500Gi");
  });
});

describe("clearing a custom route on upgrade", () => {
  const layer = { modelRoute: { enabled: true, nginx: { route: "old-route" } } };

  it("sends an emptied route as empty, for a video and an LLM release", () => {
    expect((request(form({ modelRoute: true, route: "" }), { formLayer: layer }).overrides as Tree).modelRoute).toEqual({ enabled: true, nginx: { route: "" } });
    const llm = planRequest({ ...EMPTY, serviceId: "m", modelRoute: true, route: "" }, { model: "m", formLayer: layer }).overrides as Record<string, { nginx?: { route?: string } }>;
    expect(llm.modelRoute.nginx?.route).toBe("");
  });

  it("writes no route key when the release never had one", () => {
    expect((request(form({ modelRoute: true, route: "" }), { formLayer: {} }).overrides as Tree).modelRoute).toEqual({ enabled: true });
    const llm = planRequest({ ...EMPTY, serviceId: "m", modelRoute: true, route: "" }, { model: "m", formLayer: {} }).overrides as Record<string, { nginx?: Record<string, unknown> }>;
    expect(llm.modelRoute.nginx).not.toHaveProperty("route");
  });
});

describe("videoProblem refuses a zero", () => {
  it("in an enabled pool's replicas, TP or Ulysses", () => {
    for (const k of ["replicaCount", "tpSize", "ulyssesDegree"] as const) {
      expect(videoProblem(withPool(fields(), "fl2va", { [k]: "0" }))).toEqual({ code: "zero" });
    }
    // A disabled pool's fields are not sent, so they are not checked.
    expect(videoProblem(withPool(fields(), "ref2va", { enabled: false, tpSize: "0" }))).toBeUndefined();
  });
});

describe("videoSeed", () => {
  it("seeds a video variant once per values, clears on leaving it, and leaves an LLM deploy alone", () => {
    let s = videoSeed(null, false, { a: 1 });
    expect(s.action).toBeUndefined();
    // The LLM variant's values change (another version): nothing to do, typed values stay.
    expect(videoSeed(s.key, false, { a: 2 }).action).toBeUndefined();
    s = videoSeed(s.key, true, { pools: {} });
    expect(s.action).toBe("seed");
    expect(videoSeed(s.key, true, { pools: {} }).action).toBeUndefined();
    expect(videoSeed(s.key, true, { pools: { fl2va: {} } }).action).toBe("seed");
    expect(videoSeed(s.key, false, undefined).action).toBe("clear");
  });
});

describe("poolScalers", () => {
  const obj = (kind: string, name: string, spec: object) => ({ ref: { kind, name }, live: { spec } }) as unknown as ObjectResult;
  it("keeps the scalers of the pools whose JobSLO has a maximum", () => {
    const objects = [
      obj("JobSLORequirement", "a", { serviceId: "h3-fl2va" }),
      obj("JobSLORequirement", "b", { serviceId: "h3-ref2va", maximumDeployment: { type: "replica", value: 2 } }),
      obj("LLMScaler", "h3-fl2va", { customProvider: { serviceId: "h3-fl2va" } }),
      obj("LLMScaler", "h3-ref2va", { customProvider: { serviceId: "h3-ref2va" } }),
    ];
    const { all, scaled } = poolScalers(objects);
    expect(all.map((o) => o.ref.name)).toEqual(["h3-fl2va", "h3-ref2va"]);
    expect(scaled.map((o) => o.ref.name)).toEqual(["h3-ref2va"]);
  });
});
