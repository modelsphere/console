import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GPUSpec, Node, Plan } from "@swiss/lib/api";
import { DeploySettings, EMPTY, formFromPlan, planRequest } from "@swiss/components/DeploySettings";

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
];

const nodes = [
  { Name: "n-h100", GPUs: 8, gpusFree: 8, Schedulable: true, Ready: true, GPUProduct: "NVIDIA-H100-80GB-HBM3", GPUResource: "nvidia.com/gpu" },
  { Name: "n-h20", GPUs: 8, gpusFree: 8, Schedulable: true, Ready: true, GPUProduct: "NVIDIA-H20", GPUResource: "nvidia.com/gpu" },
] as unknown as Node[];

describe("DeploySettings PD roles", () => {
  it("replaces top-level GPU product & cluster capacity with Prefill/Decode GPU affinity while keeping Scheduler & Resources shared", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={{
          ...EMPTY,
          serviceId: "ds-r1",
          pd: {
            prefill: { gpuProducts: ["NVIDIA-H100-80GB-HBM3"] },
            decode: { gpuProducts: ["NVIDIA-H20"] },
          },
        }}
        onChange={() => {}}
        cluster={{ name: "c", schedulerName: "volcano" } as never}
        supportedGPUs={["NVIDIA-H100-80GB-HBM3"]}
        nodes={nodes}
        gpuSpecs={gpuSpecs}
        gpuVendor="nvidia"
        capacity={{ value: { nodes: 99, gpus: 792 }, perPod: 8, needNodes: 1, refreshing: false, onRefresh: () => {} }}
        pd={{
          enabled: true,
          colocate: false,
          prefill: { role: "prefill", gpus: 8, replicas: 2, size: 1, hasAffinityReplace: false, gpuProducts: [] },
          decode: { role: "decode", gpus: 4, replicas: 1, size: 2, hasAffinityReplace: false, gpuProducts: [] },
        }}
      />,
    );
    expect(html).toContain("Prefill GPU product");
    expect(html).toContain("Decode GPU product");
    expect(html).toContain("pd.prefill.affinityReplace · 8 GPUs/pod · 2 replicas");
    expect(html).toContain("pd.decode.affinityReplace · 4 GPUs/pod · 1 replica · 2 nodes/replica");
    expect(html).toContain("NVIDIA-H20 unverified with this variant");
    expect(html).toContain("Scheduler");
    expect(html).toContain("Resources");
    expect(html).not.toContain(">GPU product<");
    expect(html).not.toContain("On this cluster");
    expect(html).not.toContain('aria-label="prefill scheduler"');
    expect(html).not.toContain('aria-label="decode scheduler"');
    expect(html).not.toContain("set by");
  });

  it("still shows legacy top-level GPU product when split PD form carries non-empty form.gpuProducts", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={{
          ...EMPTY,
          gpuProducts: ["NVIDIA-H100-80GB-HBM3"],
        }}
        onChange={() => {}}
        supportedGPUs={["NVIDIA-H100-80GB-HBM3"]}
        nodes={nodes}
        gpuSpecs={gpuSpecs}
        gpuVendor="nvidia"
        pd={{
          enabled: true,
          colocate: false,
          prefill: { role: "prefill", gpus: 8, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
          decode: { role: "decode", gpus: 4, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
        }}
      />,
    );
    expect(html).toContain(">GPU product<");
    expect(html).toContain(">Prefill GPU product<");
    expect(html).not.toContain("On this cluster");
  });

  it("renders colocate note and keeps top-level GPU product when pd.colocate is true", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={EMPTY}
        onChange={() => {}}
        supportedGPUs={["NVIDIA-H100-80GB-HBM3"]}
        nodes={nodes}
        gpuSpecs={gpuSpecs}
        gpuVendor="nvidia"
        capacity={{ value: { nodes: 99, gpus: 792 }, perPod: 8, needNodes: 1, refreshing: false, onRefresh: () => {} }}
        pd={{
          enabled: true,
          colocate: true,
          prefill: { role: "prefill", gpus: 4, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
          decode: { role: "decode", gpus: 4, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
        }}
      />,
    );
    expect(html).toContain("colocated in one shared Pod");
    expect(html).toContain("Prefill: 4 GPUs · Decode: 4 GPUs");
    expect(html).toContain(">GPU product<");
    expect(html).toContain("On this cluster");
    expect(html).not.toContain(">Prefill GPU product<");
  });

  it("warns and disables picking new role GPU chips when gpuSpecs lacks a labelKey", () => {
    const html = renderToStaticMarkup(
      <DeploySettings
        form={EMPTY}
        onChange={() => {}}
        nodes={nodes}
        gpuSpecs={[{ vendor: "nvidia", resource: "nvidia.com/gpu", labelKey: "" }]}
        gpuVendor="nvidia"
        pd={{
          enabled: true,
          colocate: false,
          prefill: { role: "prefill", gpus: 8, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
          decode: { role: "decode", gpus: 8, replicas: 1, size: 1, hasAffinityReplace: false, gpuProducts: [] },
        }}
      />,
    );
    expect(html).toContain("no labelKey in site GPU profile for this resource");
  });

  it("round-trips pd role GPU affinity through planRequest and formFromPlan while leaving formLayer pd.schedulerName untouched", () => {
    const req = planRequest(
      {
        ...EMPTY,
        serviceId: "ds-r1",
        pd: {
          prefill: { gpuProducts: ["NVIDIA-H100-80GB-HBM3"] },
          decode: { gpuProducts: ["NVIDIA-H20"] },
        },
      },
      { model: "m", gpuSpecs, gpuVendor: "nvidia" },
    );

    const pdOut = req.overrides?.pd as Record<string, Record<string, unknown>>;
    expect(pdOut.prefill.schedulerName).toBeUndefined();
    expect(pdOut.prefill.affinityReplace).toEqual({
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
    });

    const existingLayer = {
      ...req.overrides,
      pd: {
        ...pdOut,
        prefill: { ...pdOut.prefill, schedulerName: "volcano" },
      },
    };
    const seeded = formFromPlan(
      { release: { name: "r", namespace: "n" }, layers: { form: existingLayer } } as unknown as Plan,
      gpuSpecs,
    );
    expect(seeded.pd).toEqual({
      prefill: { gpuProducts: ["NVIDIA-H100-80GB-HBM3"] },
      decode: { gpuProducts: ["NVIDIA-H20"] },
    });
    expect(seeded.affinity).toEqual([]);

    // Upgrade clearing prefill GPU affinity preserves formLayer's prefill.schedulerName untouched.
    const upgraded = planRequest(
      {
        ...seeded,
        pd: {
          prefill: { gpuProducts: [] },
          decode: seeded.pd.decode,
        },
      },
      { model: "m", formLayer: existingLayer, gpuSpecs, gpuVendor: "nvidia" },
    );
    expect(upgraded.overrides?.pd).toEqual({
      prefill: { schedulerName: "volcano", affinityReplace: null },
      decode: pdOut.decode,
    });
  });
});
