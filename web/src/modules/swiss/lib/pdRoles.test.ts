import { describe, expect, it } from "vitest";
import type { GPUSpec, Node } from "@swiss/lib/api";
import {
  affinityRulesForForm,
  applyPdOverrides,
  emptyPdOverrides,
  extractPdInfo,
  helmPdInfo,
  pdFromLayer,
  pdRoleCapacity,
} from "./pdRoles";

const gpuSpecs: GPUSpec[] = [
  {
    vendor: "nvidia",
    resource: "nvidia.com/gpu",
    labelKey: "nvidia.com/gpu.product",
    products: [
      { product: "NVIDIA-H100-80GB-HBM3", values: ["NVIDIA-H100-SXM5"] },
      { product: "NVIDIA-H20" },
    ],
  },
  {
    vendor: "ascend",
    resource: "volcano.sh/Ascend910B4-1",
    labelKey: "volcano.sh/npu-name",
    products: [{ product: "Ascend-910B4", values: ["Ascend910B4-1"] }],
  },
];

describe("extractPdInfo", () => {
  it("returns undefined when pd.enabled is false or absent", () => {
    expect(extractPdInfo(undefined)).toBeUndefined();
    expect(extractPdInfo({ pd: { enabled: false } })).toBeUndefined();
    expect(extractPdInfo({ model: { gpus: "8" } })).toBeUndefined();
  });

  it("reads role gpus (falling back to model.gpus), replicas, size, and affinityReplace", () => {
    const info = extractPdInfo(
      {
        model: { gpus: "8" },
        pd: {
          enabled: true,
          colocate: false,
          prefill: {
            replicas: 2,
            size: 1,
            affinityReplace: {
              nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [
                    { matchExpressions: [{ key: "nvidia.com/gpu.product", operator: "In", values: ["NVIDIA-H100-SXM5"] }] },
                  ],
                },
              },
            },
          },
          decode: {
            gpus: 4,
            replicas: 1,
            size: 2,
            affinityReplace: null,
          },
        },
      },
      gpuSpecs,
    );
    expect(info).toEqual({
      enabled: true,
      colocate: false,
      prefill: {
        role: "prefill",
        gpus: 8,
        replicas: 2,
        size: 1,
        hasAffinityReplace: true,
        gpuProducts: ["NVIDIA-H100-80GB-HBM3"],
      },
      decode: {
        role: "decode",
        gpus: 4,
        replicas: 1,
        size: 2,
        hasAffinityReplace: false,
        gpuProducts: [],
      },
    });
  });

  it("captures colocate flag cleanly", () => {
    const info = extractPdInfo({ model: { gpus: 4 }, pd: { enabled: true, colocate: true } });
    expect(info?.colocate).toBe(true);
    expect(info?.prefill?.gpus).toBe(4);
    expect(info?.decode?.gpus).toBe(4);
  });

  it("merges chart defaults and composed overrides via helmPdInfo", () => {
    const info = helmPdInfo(
      {
        defaults: "model:\n  gpus: 8\npd:\n  enabled: false\n  colocate: false\n  prefill:\n    replicas: 1\n    size: 1\n  decode:\n    replicas: 1\n    size: 1\n",
        overrides: "pd:\n  enabled: true\n  decode:\n    gpus: 4\n",
      },
      gpuSpecs,
    );
    expect(info).toEqual({
      enabled: true,
      colocate: false,
      prefill: {
        role: "prefill",
        gpus: 8,
        replicas: 1,
        size: 1,
        hasAffinityReplace: false,
        gpuProducts: [],
      },
      decode: {
        role: "decode",
        gpus: 4,
        replicas: 1,
        size: 1,
        hasAffinityReplace: false,
        gpuProducts: [],
      },
    });
  });
});

describe("pdFromLayer & applyPdOverrides", () => {
  it("writes affinityReplace using site GPUSpec labelKey and seeds back canonical product names", () => {
    const layer: Record<string, unknown> = {};
    const pd = emptyPdOverrides();
    pd.prefill = { gpuProducts: ["NVIDIA-H100-80GB-HBM3"] };
    pd.decode = { gpuProducts: ["NVIDIA-H20"] };

    applyPdOverrides(layer, pd, { gpuSpecs, gpuVendor: "nvidia" });
    expect(layer).toEqual({
      pd: {
        prefill: {
          affinityReplace: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: [
                      {
                        key: "nvidia.com/gpu.product",
                        operator: "In",
                        values: ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H100-SXM5"],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        decode: {
          affinityReplace: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: "nvidia.com/gpu.product", operator: "In", values: ["NVIDIA-H20"] }] },
                ],
              },
            },
          },
        },
      },
    });

    expect(pdFromLayer(layer, gpuSpecs)).toEqual({
      prefill: { gpuProducts: ["NVIDIA-H100-80GB-HBM3"] },
      decode: { gpuProducts: ["NVIDIA-H20"] },
    });
    expect(affinityRulesForForm(layer, gpuSpecs)).toEqual([]);
  });

  it("removes the role GPU term when cleared and leaves other role keys untouched", () => {
    const formLayer: Record<string, unknown> = {
      pd: {
        prefill: {
          replicas: 2,
          schedulerName: "volcano",
          affinityReplace: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: "nvidia.com/gpu.product", operator: "In", values: ["NVIDIA-H20"] }] },
                ],
              },
            },
          },
        },
      },
    };
    const nextLayer = structuredClone(formLayer);
    applyPdOverrides(nextLayer, emptyPdOverrides(), { gpuSpecs, gpuVendor: "nvidia", formLayer });
    expect(nextLayer).toEqual({
      pd: {
        prefill: {
          replicas: 2,
          schedulerName: "volcano",
        },
      },
    });
  });

  it("preserves non-GPU rules and podAntiAffinity when clearing or updating role gpuProducts", () => {
    const storageNet = { matchExpressions: [{ key: "ebof.modelsphere.io/storage-net", operator: "In", values: ["true"] }] };
    const gpuTerm = { matchExpressions: [{ key: "nvidia.com/gpu.product", operator: "In", values: ["NVIDIA-H20"] }] };
    const formLayer: Record<string, unknown> = {
      pd: {
        prefill: {
          affinityReplace: {
            podAntiAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [] },
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [storageNet, gpuTerm] },
            },
          },
        },
      },
    };
    expect(affinityRulesForForm(formLayer, gpuSpecs)).toHaveLength(1);
    const cleared = structuredClone(formLayer);
    applyPdOverrides(cleared, emptyPdOverrides(), { gpuSpecs, formLayer });
    expect(cleared).toEqual({
      pd: {
        prefill: {
          affinityReplace: {
            podAntiAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [] },
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [storageNet] },
            },
          },
        },
      },
    });
  });
});

describe("pdRoleCapacity", () => {
  const nodes = [
    { Name: "n1", GPUs: 8, gpusFree: 8, Schedulable: true, Ready: true, GPUProduct: "NVIDIA-H100-80GB-HBM3", GPUResource: "nvidia.com/gpu" },
    { Name: "n2", GPUs: 4, gpusFree: 4, Schedulable: true, Ready: true, GPUProduct: "NVIDIA-H20", GPUResource: "nvidia.com/gpu" },
  ] as unknown as Node[];

  it("computes capacity per role against role gpus, size, and effective product selection", () => {
    const info = extractPdInfo({
      model: { gpus: 8 },
      pd: { enabled: true, colocate: false, prefill: { replicas: 1, size: 1 }, decode: { gpus: 4, replicas: 2, size: 1 } },
    });
    const pd = emptyPdOverrides();
    pd.decode.gpuProducts = ["NVIDIA-H20"];

    const prefillCap = pdRoleCapacity(info?.prefill, pd.prefill, {
      nodes,
      gpuSpecs,
      gpuVendor: "nvidia",
      topGpuProducts: ["NVIDIA-H100-80GB-HBM3"],
    });
    expect(prefillCap).toEqual({
      value: { nodes: 1, gpus: 8, free: { nodes: 1, gpus: 8 } },
      perPod: 8,
      needNodes: 1,
    });

    const decodeCap = pdRoleCapacity(info?.decode, pd.decode, {
      nodes,
      gpuSpecs,
      gpuVendor: "nvidia",
      topGpuProducts: ["NVIDIA-H100-80GB-HBM3"],
    });
    expect(decodeCap).toEqual({
      value: { nodes: 1, gpus: 4, free: { nodes: 1, gpus: 4 } },
      perPod: 4,
      needNodes: 1,
    });
  });
});
