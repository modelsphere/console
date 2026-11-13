import { describe, expect, it } from "vitest";
import { EMPTY, formFromPlan, planRequest } from "@swiss/components/DeploySettings";
import type { Plan } from "@swiss/lib/api";
import {
  baseResourceRows,
  customResourceRows,
  gpuRequestSummary,
  helmResources,
  needsHugepageComputeHint,
  replaceCustomResources,
  resourceKeyProblem,
} from "./resources";

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
  it("writes only non-empty entries to overrides.resources and preserves or clears on upgrade", () => {
    const req = planRequest(
      {
        ...EMPTY,
        resources: {
          requests: { cpu: " 8 ", memory: "" },
          limits: { "hugepages-2Mi": "1Gi" },
        },
      },
      { model: "m" },
    );
    expect(req.overrides?.resources).toEqual({
      requests: { cpu: "8" },
      limits: { "hugepages-2Mi": "1Gi" },
    });

    const plan = {
      release: { namespace: "default" },
      layers: {
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
      limits: { "hugepages-2Mi": "1Gi" },
    });

    // Clearing cpu and hugepages-2Mi drops those scalar overrides from base formLayer while preserving null deletion.
    const clearedReq = planRequest(
      {
        ...seeded,
        resources: {
          requests: { memory: "32Gi" },
          limits: {},
        },
      },
      { model: "m", formLayer: plan.layers.form },
    );
    expect(clearedReq.overrides?.resources).toEqual({
      requests: { memory: "32Gi" },
      limits: { "ephemeral-storage": null },
    });
  });
});

describe("custom rows, validation, and hugepages hint", () => {
  const base = { requests: { cpu: "4" }, limits: { "ephemeral-storage": "28Gi" } };

  it("separates custom rows from base rows and validates reserved/duplicate keys", () => {
    expect(
      customResourceRows(base, {
        requests: { cpu: "8", memory: "16Gi" },
        limits: { "hugepages-2Mi": "1Gi" },
      }),
    ).toEqual([
      { key: "memory", request: "16Gi", limit: "" },
      { key: "hugepages-2Mi", request: "", limit: "1Gi" },
    ]);

    expect(
      resourceKeyProblem("nvidia.com/gpu", {
        gpuResource: "nvidia.com/gpu",
        baseKeys: new Set(["cpu"]),
      }),
    ).toBe("gpuReserved");
    expect(
      resourceKeyProblem("cpu", {
        gpuResource: "nvidia.com/gpu",
        baseKeys: new Set(["cpu"]),
      }),
    ).toBe("exists");
    expect(
      resourceKeyProblem("memory", {
        gpuResource: "nvidia.com/gpu",
        baseKeys: new Set(["cpu"]),
        duplicateKeys: new Set(["memory"]),
      }),
    ).toBe("duplicate");

    const next = replaceCustomResources(
      base,
      { requests: { cpu: "8" }, limits: {} },
      [
        { key: "cpu", request: "99", limit: "" },
        { key: "nvidia.com/gpu", request: "", limit: "1" },
        { key: "memory", request: "32Gi", limit: "64Gi" },
      ],
      "nvidia.com/gpu",
    );
    expect(next).toEqual({
      requests: { cpu: "8", memory: "32Gi" },
      limits: { memory: "64Gi" },
    });
  });

  it("flags hugepages without cpu or memory", () => {
    expect(
      needsHugepageComputeHint(undefined, { requests: {}, limits: { "hugepages-2Mi": "1Gi" } }),
    ).toBe(true);
    expect(
      needsHugepageComputeHint(base, { requests: {}, limits: { "hugepages-2Mi": "1Gi" } }),
    ).toBe(false);
    expect(
      needsHugepageComputeHint(undefined, { requests: { memory: "4Gi" }, limits: { "hugepages-2Mi": "1Gi" } }),
    ).toBe(false);
  });
});
