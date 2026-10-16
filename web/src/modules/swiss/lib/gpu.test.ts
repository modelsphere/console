import { describe, expect, it } from "vitest";
import { productChoices, unlistedProducts, vendorProducts } from "@swiss/lib/gpu";

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
