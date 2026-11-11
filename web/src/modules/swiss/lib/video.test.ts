import { describe, expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
import { isVideoDeployment, VIDEO_EMPTY, videoDefaults, videoFormFromPlan, videoGpus, videoOverrides, videoPlanRequest, videoProblem, type VideoForm } from "./video";

const form = (patch: Partial<VideoForm> = {}): VideoForm => ({ ...VIDEO_EMPTY, serviceId: "h3", ...patch });
const withPool = (f: VideoForm, p: "fl2va" | "ref2va", patch: Partial<VideoForm["pools"]["fl2va"]>): VideoForm => ({
  ...f,
  pools: { ...f.pools, [p]: { ...f.pools[p], ...patch } },
});

describe("videoOverrides", () => {
  it("writes both pools, turbo, storage and the autoscale switches explicitly", () => {
    expect(videoOverrides(form())).toEqual({
      pools: {
        fl2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 } } },
        ref2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 } }, turbo: { enabled: true } },
      },
      scaler: { enabled: false },
      sloRequirement: { enabled: false },
      sharedStorage: { size: "500Gi" },
      modelRoute: { enabled: false },
      sglang: { tolerations: [{ key: "nvidia.com/gpu", operator: "Exists", effect: "NoSchedule" }] },
    });
  });

  it("writes only enabled: false for a disabled pool, and no turbo without ref2va", () => {
    const o = videoOverrides(withPool(form(), "ref2va", { enabled: false })) as { pools: Record<string, unknown> };
    expect(o.pools.ref2va).toEqual({ enabled: false });
  });

  it("turns the scaler and the SLO requirement on together, and leaves an empty max out", () => {
    const f = withPool(withPool(form({ autoscale: true }), "fl2va", { autoscaleMax: "6" }), "ref2va", {});
    const o = videoOverrides(f) as Record<string, Record<string, unknown>>;
    expect(o.scaler).toEqual({ enabled: true });
    expect(o.sloRequirement).toEqual({ enabled: true });
    const pools = o.pools as Record<string, Record<string, unknown>>;
    expect(pools.fl2va.autoscale).toEqual({ min: 1, max: 6, maxDepth: 5 });
    // No maximum is the pool not autoscaled: the key is not written.
    expect(pools.ref2va.autoscale).toEqual({ min: 1, maxDepth: 2 });
  });

  it("writes no autoscale keys while autoscaling is off", () => {
    const o = videoOverrides(withPool(form(), "fl2va", { autoscaleMax: "6" })) as { pools: Record<string, Record<string, unknown>> };
    expect(o.pools.fl2va.autoscale).toBeUndefined();
  });

  it("sends the database URL, storage class and route only when given", () => {
    const o = videoOverrides(form({ databaseUrl: " postgresql://u:p@db/x ", storageClass: "cephfs", modelRoute: true })) as Record<string, Record<string, unknown>>;
    expect(o.database).toEqual({ url: "postgresql://u:p@db/x" });
    expect(o.sharedStorage).toEqual({ storageClass: "cephfs", size: "500Gi" });
    // An empty route field publishes on the service ID, which is what swissd reports.
    expect(o.modelRoute).toEqual({ enabled: true, route: "h3" });
  });

  it("puts scheduling on the GPU pods", () => {
    const o = videoOverrides(form({ tolerations: [], priorityClassName: "inference", schedulerName: "volcano", gpuProducts: ["H100"] }));
    expect(o.sglang).toEqual({ tolerations: [], priorityClassName: "inference", schedulerName: "volcano", gpuProduct: ["H100"] });
  });
});

describe("videoPlanRequest", () => {
  it("carries the identity and lays the form over a release's layer and a preset", () => {
    const req = videoPlanRequest(form({ namespace: "video", edits: "a: 1" }), {
      model: "minimax-h3",
      variant: "h3",
      preset: { sglang: { nodeSelector: { pool: "gpu" } } },
      formLayer: { database: { url: "kept" } },
    });
    expect(req).toMatchObject({ model: "minimax-h3", variant: "h3", release: "h3", serviceId: "h3", namespace: "video", editsYAML: "a: 1" });
    expect(req.overrides).toMatchObject({ database: { url: "kept" }, sglang: { nodeSelector: { pool: "gpu" } } });
    // Nothing of the LLM form.
    for (const k of ["cart", "cache", "replicaCount", "image", "serviceMonitor"]) expect(req.overrides).not.toHaveProperty(k);
    expect(req.localPath).toBeUndefined();
  });
});

describe("videoGpus", () => {
  it("sums tp × ulysses × replicas over enabled pools, and the ceiling over autoscaled ones", () => {
    let f = withPool(form(), "fl2va", { replicaCount: "2", tpSize: "2", ulyssesDegree: "2" });
    expect(videoGpus(f)).toEqual({ perPod: { fl2va: 4, ref2va: 4 }, total: 12, ceiling: 12 });
    f = withPool({ ...f, autoscale: true }, "ref2va", { autoscaleMax: "3" });
    expect(videoGpus(f).ceiling).toBe(20);
    expect(videoGpus(withPool(f, "ref2va", { enabled: false })).total).toBe(8);
  });
});

describe("videoProblem", () => {
  it("needs a service ID, a pool, and a maximum no lower than the minimum", () => {
    expect(videoProblem(form({ serviceId: "" }))).toEqual({ code: "serviceId" });
    expect(videoProblem(withPool(withPool(form(), "fl2va", { enabled: false }), "ref2va", { enabled: false }))).toEqual({ code: "noPool" });
    expect(videoProblem(withPool(form({ autoscale: true }), "fl2va", { autoscaleMin: "3", autoscaleMax: "2" }))).toEqual({ code: "maxBelowMin", pool: "fl2va" });
    // An empty maximum is no autoscaling, never a range below the minimum.
    expect(videoProblem(withPool(form({ autoscale: true }), "fl2va", { autoscaleMin: "3" }))).toBeUndefined();
    expect(videoProblem(form())).toBeUndefined();
  });
});

describe("videoDefaults and videoFormFromPlan", () => {
  it("starts from the variant's values over the console's defaults", () => {
    const f = videoDefaults({ pools: { fl2va: { replicaCount: 3 }, ref2va: { enabled: false } } }, { modelRoute: true });
    expect(f.pools.fl2va.replicaCount).toBe("3");
    expect(f.pools.ref2va.enabled).toBe(false);
    expect(f.modelRoute).toBe(true);
    expect(f.pools.fl2va.autoscaleMax).toBe("");
  });

  it("round-trips the form layer, and never reads the database URL back into the form", () => {
    const f = withPool(form({ autoscale: true, modelRoute: true, route: "video", databaseUrl: "postgresql://secret", storageClass: "cephfs", turbo: false }), "fl2va", { replicaCount: "2", autoscaleMax: "4" });
    const plan = { release: { name: "h3", namespace: "video" }, engine: "video", layers: { form: videoOverrides(f) } } as unknown as Plan;
    const back = videoFormFromPlan(plan);
    expect(back.databaseUrl).toBe("");
    expect(back.databaseKept).toBe(true);
    expect(videoOverrides({ ...back, databaseUrl: "postgresql://secret" })).toEqual(videoOverrides({ ...f, namespace: "video" }));
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
