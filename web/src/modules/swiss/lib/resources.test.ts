import { describe, expect, it } from "vitest";
import { EMPTY, formFromPlan, planRequest } from "@swiss/components/DeploySettings";
import type { Plan } from "@swiss/lib/api";
import { baseResourceRows, gpuRequestSummary, helmResources } from "./resources";

describe("helmResources", () => {
  it("merges chart defaults with layer overrides, handles null deletions, and reads GPU summary", () => {
    const res = helmResources({
      defaults: [
        "resources:",
        "  requests:",
        "    cpu: 2",
        "    memory: 8Gi",
        "  limits:",
        "    cpu: 4",
        "    memory: 16Gi",
      ].join("\n"),
      overrides: [
        "resources:",
        "  requests:",
        "    cpu: 4",
        "    ephemeral-storage: 28Gi",
        "  limits:",
        "    cpu: null",
        "    hugepages-2Mi: 1Gi",
        "    rdma/hca_shared: '1'",
        "model:",
        "  gpuResource: nvidia.com/gpu",
        "  gpus: 2",
        "pd:",
        "  enabled: true",
        "  prefill:",
        "    gpus: 1",
        "  decode:",
        "    gpus: 1",
      ].join("\n"),
    });

    expect(res).toEqual({
      requests: { cpu: "4", memory: "8Gi", "ephemeral-storage": "28Gi" },
      limits: { memory: "16Gi", "hugepages-2Mi": "1Gi", "rdma/hca_shared": "1" },
      gpu: {
        resource: "nvidia.com/gpu",
        gpus: "2",
        pdRoles: [
          { role: "prefill", gpus: "1" },
          { role: "decode", gpus: "1" },
        ],
      },
    });
  });

  it("sorts baseResourceRows with cpu, memory, ephemeral-storage, hugepages, then custom keys", () => {
    const rows = baseResourceRows({
      requests: { "rdma/hca_shared": "1", memory: "16Gi", cpu: "4" },
      limits: { "hugepages-2Mi": "1Gi", "ephemeral-storage": "28Gi", "hugepages-1Gi": "2Gi" },
    });
    expect(rows.map((r) => r.key)).toEqual([
      "cpu",
      "memory",
      "ephemeral-storage",
      "hugepages-1Gi",
      "hugepages-2Mi",
      "rdma/hca_shared",
    ]);
    expect(rows[0]).toEqual({ key: "cpu", request: "4", limit: "" });
    expect(rows[4]).toEqual({ key: "hugepages-2Mi", request: "", limit: "1Gi" });
  });
});

describe("gpuRequestSummary", () => {
  it("combines picked GPU resource with helmValues or cluster perPod GPUs and omits zero-GPU models", () => {
    expect(
      gpuRequestSummary({
        base: { requests: {}, limits: {}, gpu: { resource: "nvidia.com/gpu", gpus: "4" } },
        formGpuResource: "nvidia.com/mig-1g.5gb",
        gpuResources: ["nvidia.com/gpu"],
        perPodGpus: 2,
      }),
    ).toEqual({ resource: "nvidia.com/mig-1g.5gb", gpus: "4" });

    expect(
      gpuRequestSummary({
        gpuResources: ["huawei.com/Ascend910"],
        perPodGpus: 2,
      }),
    ).toEqual({ resource: "huawei.com/Ascend910", gpus: "2" });

    expect(
      gpuRequestSummary({
        base: { requests: {}, limits: {}, gpu: { resource: "nvidia.com/gpu", gpus: "0" } },
        perPodGpus: 0,
      }),
    ).toBeUndefined();
  });
});

describe("resources form round-trip", () => {
  it("derives default overrides and custom rows, keeping gpu and base keys and the last non-empty duplicate", () => {
    const req = planRequest(
      {
        ...EMPTY,
        resources: { requests: { cpu: " 8 ", memory: "" }, limits: {} },
        customResources: [
          { key: "cpu", request: "99", limit: "" },
          { key: "nvidia.com/gpu", request: "", limit: "1" },
          { key: "memory", request: "32Gi", limit: "" },
          { key: "memory", request: "", limit: "64Gi" },
          { key: " ", request: "1", limit: "1" },
          { key: "hugepages-2Mi", request: "", limit: "1Gi" },
        ],
      },
      { model: "m" },
    );
    expect(req.overrides?.resources).toEqual({
      requests: { cpu: "99", memory: "32Gi" },
      limits: { "nvidia.com/gpu": "1", memory: "64Gi", "hugepages-2Mi": "1Gi" },
    });
  });

  it("seeds custom rows from form-layer keys outside chart/site, and drops cleared scalars", () => {
    const plan = {
      release: { namespace: "default" },
      layers: {
        site: {
          resources: {
            requests: { cpu: "4", memory: "8Gi" },
            limits: { memory: "16Gi" },
          },
        },
        form: {
          resources: {
            requests: { cpu: "8", memory: "16Gi" },
            limits: { "hugepages-2Mi": "1Gi", "ephemeral-storage": null },
          },
        },
      },
    } as unknown as Plan;

    const seeded = formFromPlan(plan);
    expect(seeded.resources).toEqual({
      requests: { cpu: "8", memory: "16Gi" },
      limits: {},
    });
    expect(seeded.customResources).toEqual([{ key: "hugepages-2Mi", request: "", limit: "1Gi" }]);

    const cleared = planRequest(
      {
        ...seeded,
        resources: { requests: { memory: "32Gi" }, limits: {} },
        customResources: [],
      },
      { model: "m", formLayer: plan.layers.form },
    );
    expect(cleared.overrides?.resources).toEqual({
      requests: { memory: "32Gi" },
      limits: { "ephemeral-storage": null },
    });
  });
});
