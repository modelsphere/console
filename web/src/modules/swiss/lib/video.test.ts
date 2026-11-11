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
        fl2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 }, gpuCount: 4 } },
        ref2va: { enabled: true, replicaCount: 1, sglang: { args: { tpSize: 4, ulyssesDegree: 1 }, gpuCount: 4 }, turbo: { enabled: true } },
      },
      scaler: { enabled: false },
      sloRequirement: { enabled: false },
      sharedStorage: { size: "500Gi" },
      modelRoute: { enabled: false },
      sglang: { tolerations: [{ key: "nvidia.com/gpu", operator: "Exists", effect: "NoSchedule" }] },
    });
  });

  it("writes each pool's GPU count as tp × ulysses, which the chart checks against the args", () => {
    const o = videoOverrides(withPool(withPool(form(), "fl2va", { tpSize: "2", ulyssesDegree: "1" }), "ref2va", { tpSize: "2", ulyssesDegree: "4" })) as { pools: Record<string, { sglang: Record<string, unknown> }> };
    expect(o.pools.fl2va.sglang.gpuCount).toBe(2);
    expect(o.pools.ref2va.sglang.gpuCount).toBe(8);
    // Empty boxes are the chart's 4 × 1.
    expect((videoOverrides(withPool(form(), "fl2va", { tpSize: "", ulyssesDegree: "" })) as { pools: Record<string, { sglang: Record<string, unknown> }> }).pools.fl2va.sglang).toEqual({ gpuCount: 4 });
  });

  it("writes only enabled: false for a disabled pool, and no turbo without ref2va", () => {
    const o = videoOverrides(withPool(form(), "ref2va", { enabled: false })) as { pools: Record<string, unknown> };
    expect(o.pools.ref2va).toEqual({ enabled: false });
  });

  it("turns the scaler and the SLO requirement on together, and writes nothing per pool", () => {
    const o = videoOverrides(form({ autoscale: true })) as Record<string, Record<string, unknown>>;
    expect(o.scaler).toEqual({ enabled: true });
    expect(o.sloRequirement).toEqual({ enabled: true });
    // The chart gives each pool its JobSLO defaults (no maximum: not scaled);
    // the SLO card sets the rest after the deploy.
    const pools = o.pools as Record<string, Record<string, unknown>>;
    for (const p of ["fl2va", "ref2va"]) {
      expect(pools[p].sloRequirement).toBeUndefined();
      expect(pools[p].scaler).toBeUndefined();
    }
  });

  it("sends the database URL, storage class and route only when given", () => {
    const o = videoOverrides(form({ databaseUrl: " postgresql://u:p@db/x ", storageClass: "cephfs", modelRoute: true })) as Record<string, Record<string, unknown>>;
    expect(o.database).toEqual({ url: "postgresql://u:p@db/x" });
    expect(o.sharedStorage).toEqual({ storageClass: "cephfs", size: "500Gi" });
    // An empty route field writes no route: the chart and swissd both take the service ID.
    expect(o.modelRoute).toEqual({ enabled: true });
    expect(videoOverrides(form({ modelRoute: true, route: "video" })).modelRoute).toEqual({ enabled: true, nginx: { route: "video" } });
    // A typed route under a disabled switch publishes nothing.
    expect(videoOverrides(form({ route: "video" })).modelRoute).toEqual({ enabled: false });
  });

  it("puts scheduling on the GPU pods", () => {
    const o = videoOverrides(form({ tolerations: [], priorityClassName: "inference", schedulerName: "volcano", gpuProducts: ["H100"] }));
    expect(o.sglang).toEqual({ tolerations: [], priorityClassName: "inference", schedulerName: "volcano", gpuProduct: ["H100"] });
  });
});

describe("clearing on upgrade", () => {
  const layer = {
    modelRoute: { enabled: true, nginx: { route: "old-route" } },
    sharedStorage: { storageClass: "cephfs", size: "1Ti" },
    sglang: { priorityClassName: "inference", schedulerName: "volcano", gpuProduct: ["H100"] },
    database: { url: "postgresql://kept" },
  };

  it("sends an emptied field the release had set as cleared, so the overlay drops it", () => {
    const f = form({ modelRoute: true, route: "", storageClass: "", storageSize: "", priorityClassName: "", schedulerName: "", gpuProducts: [] });
    const o = videoOverrides(f, layer) as Record<string, Record<string, unknown>>;
    expect(o.modelRoute).toEqual({ enabled: true, nginx: { route: "" } });
    expect(o.sharedStorage).toEqual({ storageClass: "", size: "" });
    expect(o.sglang).toMatchObject({ priorityClassName: "", schedulerName: "", gpuProduct: [] });
    // Empty is "keep" for the database URL, never a clear.
    expect(o.database).toBeUndefined();
    const req = videoPlanRequest(f, { model: "minimax-h3", formLayer: layer });
    expect(req.overrides).toMatchObject({ modelRoute: { nginx: { route: "" } }, sglang: { gpuProduct: [] }, database: { url: "postgresql://kept" } });
  });

  it("leaves a field alone when the release never set it, or when the form still has a value", () => {
    const o = videoOverrides(form({ storageClass: "", priorityClassName: "" }), {}) as Record<string, Record<string, unknown>>;
    expect(o.sharedStorage).toEqual({ size: "500Gi" });
    expect(o.sglang).not.toHaveProperty("priorityClassName");
    expect(o.sglang).not.toHaveProperty("gpuProduct");
    expect(o.modelRoute).toEqual({ enabled: false });
    const kept = videoOverrides(form({ modelRoute: true, route: "old-route", storageClass: "cephfs", storageSize: "1Ti", priorityClassName: "inference", schedulerName: "volcano", gpuProducts: ["H100"] }), layer);
    expect(kept).toMatchObject({ modelRoute: { nginx: { route: "old-route" } }, sharedStorage: { storageClass: "cephfs", size: "1Ti" }, sglang: { priorityClassName: "inference", schedulerName: "volcano", gpuProduct: ["H100"] } });
  });

  it("does not clear anything on a fresh deploy", () => {
    expect(videoOverrides(form({ storageClass: "", priorityClassName: "" }))).toEqual(videoOverrides(form({ storageClass: "", priorityClassName: "" }), undefined));
    expect(JSON.stringify(videoOverrides(form()))).not.toContain('""');
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
  it("sums tp × ulysses × replicas over enabled pools", () => {
    const f = withPool(form(), "fl2va", { replicaCount: "2", tpSize: "2", ulyssesDegree: "2" });
    expect(videoGpus(f)).toEqual({ perPod: { fl2va: 4, ref2va: 4 }, total: 12 });
    expect(videoGpus(withPool(f, "ref2va", { enabled: false })).total).toBe(8);
  });
});

describe("videoProblem", () => {
  it("needs a service ID and a pool", () => {
    expect(videoProblem(form({ serviceId: "" }))).toEqual({ code: "serviceId" });
    expect(videoProblem(withPool(withPool(form(), "fl2va", { enabled: false }), "ref2va", { enabled: false }))).toEqual({ code: "noPool" });
    expect(videoProblem(form())).toBeUndefined();
  });
});

describe("videoDefaults and videoFormFromPlan", () => {
  it("starts from the variant's values over the console's defaults", () => {
    const f = videoDefaults({ pools: { fl2va: { replicaCount: 3 }, ref2va: { enabled: false } } }, { modelRoute: true });
    expect(f.pools.fl2va.replicaCount).toBe("3");
    expect(f.pools.ref2va.enabled).toBe(false);
    expect(f.modelRoute).toBe(true);
  });

  it("round-trips the form layer, and never reads the database URL back into the form", () => {
    const f = withPool(form({ autoscale: true, modelRoute: true, route: "video", databaseUrl: "postgresql://secret", storageClass: "cephfs", turbo: false }), "fl2va", { replicaCount: "2" });
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
