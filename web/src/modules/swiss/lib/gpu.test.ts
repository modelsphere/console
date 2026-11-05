import { describe, expect, it } from "vitest";
import type { Node } from "@swiss/lib/api";
import { gpuCapacity, pickableProducts, productChoices, productClass, resourceProducts, scanNames, unlistedProducts, vendorProducts, vendorResources } from "@swiss/lib/gpu";

const nodes = [
  { GPUProduct: "NVIDIA-H100-80GB-HBM3", GPUResource: "nvidia.com/gpu" },
  { GPUProduct: "NVIDIA-H20", GPUResource: "nvidia.com/gpu" },
  { GPUProduct: "NVIDIA-H20", GPUResource: "nvidia.com/gpu" },
  { GPUProduct: "Ascend-910B3", GPUResource: "huawei.com/Ascend910" },
  { GPUProduct: "", GPUResource: "" },
];

describe("vendorProducts", () => {
  it("is every product on the vendor's nodes, once", () => {
    expect(vendorProducts(nodes, undefined)).toEqual(["NVIDIA-H100-80GB-HBM3", "NVIDIA-H20"]);
    expect(vendorProducts(nodes, "ascend")).toEqual(["Ascend-910B3"]);
    expect(vendorProducts(undefined, "nvidia")).toEqual([]);
  });

  it("keeps a node whose resource is unknown, as swissd does", () => {
    expect(vendorProducts([{ GPUProduct: "X" }], "ascend")).toEqual(["X"]);
  });

  it("reads a resource's vendor from the site profile's GPU table", () => {
    const volcano = { GPUProduct: "Ascend-910B4", GPUResource: "volcano.sh/Ascend910B4-1" };
    const gpus = [
      { vendor: "nvidia", resource: "nvidia.com/gpu", labelKey: "nvidia.com/gpu.product" },
      { vendor: "ascend", resource: "volcano.sh/Ascend910B4-1", labelKey: "volcano.sh/npu-name" },
    ];
    expect(vendorProducts([...nodes, volcano], "ascend")).toEqual(["Ascend-910B3"]);
    expect(vendorProducts([...nodes, volcano], "ascend", gpus)).toEqual(["Ascend-910B3", "Ascend-910B4"]);
    expect(vendorProducts([volcano], "nvidia", gpus)).toEqual([]);
  });
});

describe("resourceProducts", () => {
  it("is the canonical products nodes report under a resource, and the nodes reporting none", () => {
    expect(resourceProducts(nodes, "nvidia.com/gpu")).toEqual({ products: ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H20"], unlabelled: 0 });
    expect(resourceProducts([...nodes, { GPUProduct: "", GPUResource: "huawei.com/Ascend910" }], "huawei.com/Ascend910")).toEqual({ products: ["Ascend-910B3"], unlabelled: 1 });
    expect(resourceProducts(nodes, "amd.com/gpu")).toEqual({ products: [], unlabelled: 0 });
    expect(resourceProducts(undefined, "nvidia.com/gpu")).toEqual({ products: [], unlabelled: 0 });
  });
});

describe("productClass", () => {
  it("gives the usual cards their own preset color, and anything else a stable one", () => {
    const presets = ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H200", "NVIDIA-H20", "NVIDIA-B300-SXM6-AC", "NVIDIA-GB300", "Ascend-910B3", "Ascend-910B4"].map(productClass);
    expect(new Set(presets).size).toBe(presets.length);
    expect(productClass("NVIDIA-H20")).toContain("cyan");
    expect(productClass("Acme-X1")).toBe(productClass("Acme-X1"));
  });
});

describe("scanNames", () => {
  it("shows every name of a product, but not a lone name that is the product itself", () => {
    const n = (name: string, nodes: number) => ({ name, nodes, gpus: nodes * 8 });
    expect(scanNames({ product: "Ascend-910B4", nodes: 2, gpus: 16, names: [n("Ascend-910B4", 0), n("Ascend910B4-1", 2)] })).toHaveLength(2);
    expect(scanNames({ product: "NVIDIA-H20", nodes: 1, gpus: 8, names: [n("NVIDIA-H20", 1)] })).toEqual([]);
  });
});

describe("picking a resource", () => {
  const gpus = [
    { vendor: "ascend", resource: "huawei.com/Ascend910", labelKey: "a" },
    { vendor: "nvidia", resource: "nvidia.com/gpu", labelKey: "n" },
    { vendor: "ascend", resource: "volcano.sh/Ascend910B4-1", labelKey: "v" },
  ];
  it("lists a vendor's resources, default first", () => {
    expect(vendorResources(gpus, "ascend")).toEqual(["huawei.com/Ascend910", "volcano.sh/Ascend910B4-1"]);
    expect(vendorResources(gpus, undefined)).toEqual(["nvidia.com/gpu"]);
  });
  it("offers the picked resource's products, else the vendor's", () => {
    const all = [...nodes, { GPUProduct: "Ascend-910B4", GPUResource: "volcano.sh/Ascend910B4-1" }];
    expect(pickableProducts(all, "ascend", gpus, "volcano.sh/Ascend910B4-1")).toEqual(["Ascend-910B4"]);
    expect(pickableProducts(all, "ascend", gpus)).toEqual(["Ascend-910B3", "Ascend-910B4"]);
  });
});

describe("unlistedProducts", () => {
  it("is what the variant does not list, and nothing when it lists none", () => {
    expect(unlistedProducts(["A"], ["A", "B"])).toEqual(["B"]);
    expect(unlistedProducts([], ["A", "B"])).toEqual([]);
    expect(unlistedProducts(undefined, ["A"])).toEqual([]);
  });
});

describe("productChoices", () => {
  it("offers every product the cluster has for the vendor, listed first", () => {
    expect(productChoices(["NVIDIA-H20"], ["NVIDIA-H100-80GB-HBM3", "NVIDIA-H20"], [])).toEqual(["NVIDIA-H20", "NVIDIA-H100-80GB-HBM3"]);
  });

  it("falls back to the variant's list without inventory", () => {
    expect(productChoices(["B", "A"], [], [])).toEqual(["A", "B"]);
    expect(productChoices(["B", "A"], undefined, [])).toEqual(["A", "B"]);
  });

  it("keeps a selection the cluster no longer reports, so it can be cleared", () => {
    expect(productChoices(["A"], ["A"], ["Gone"])).toEqual(["A", "Gone"]);
  });
});

describe("gpuCapacity", () => {
  const node = (name: string, GPUResource: string, GPUProduct: string, gpusFree?: number, open = true) =>
    ({ Name: name, GPUResource, GPUProduct, GPUs: 8, gpusFree, Schedulable: open, Ready: true }) as Node;
  const cluster = [
    node("a", "volcano.sh/Ascend910B4-1", "Ascend-910B4", 8),
    node("b", "volcano.sh/Ascend910B4-1", "Ascend-910B4", 2),
    node("c", "volcano.sh/Ascend910B4-1", "Ascend-910B4", 8, false),
    node("d", "huawei.com/Ascend910", "Ascend-910B4", 8),
  ];
  it("counts the nodes carrying the resource and products, and what is free on those taking pods", () => {
    expect(gpuCapacity(cluster, { resource: "volcano.sh/Ascend910B4-1", products: ["Ascend-910B4"], perPod: 4 })).toEqual({ nodes: 3, gpus: 24, free: { gpus: 10, nodes: 1 } });
    const table = [
      { vendor: "ascend", resource: "huawei.com/Ascend910", labelKey: "a" },
      { vendor: "ascend", resource: "volcano.sh/Ascend910B4-1", labelKey: "v" },
    ];
    expect(gpuCapacity(cluster, { vendor: "ascend", products: ["Ascend-910B4"], perPod: 8 }, table)).toEqual({ nodes: 4, gpus: 32, free: { gpus: 18, nodes: 2 } });
  });
  it("shows a mismatch as nothing, and leaves free out when usage is unknown", () => {
    expect(gpuCapacity(cluster, { resource: "volcano.sh/Ascend910B4-1", products: ["Ascend-910B3"], perPod: 1 })).toEqual({ nodes: 0, gpus: 0, free: { gpus: 0, nodes: 0 } });
    expect(gpuCapacity([node("x", "nvidia.com/gpu", "NVIDIA-H20")], { perPod: 1 })?.free).toBeUndefined();
    expect(gpuCapacity(undefined, { perPod: 1 })).toBeUndefined();
  });
});
