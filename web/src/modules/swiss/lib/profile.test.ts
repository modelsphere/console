import { describe, expect, it } from "vitest";
import type { GPUSpec } from "./api";
import {
  catalogErrors,
  emptyGPURow,
  FEATURES,
  featureOn,
  gpuEntryErrors,
  gpuErrors,
  gpuRows,
  gpuTable,
  hasGPUErrors,
  hasPresetErrors,
  inOrder,
  isVendorDefault,
  makeVendorDefault,
  presetErrors,
  presetRow,
  putPreset,
  vendorGroups,
  withFeature,
  type GPURow,
} from "./profile";

describe("catalogErrors", () => {
  it("applies swissd's name and url rules", () => {
    expect(
      catalogErrors([
        { name: "", url: "" },
        { name: "Public", url: "ftp://x" },
        { name: "public", url: "https://c" },
        { name: "public", url: "https://c" },
      ]),
    ).toEqual([{ name: "required", url: "required" }, { name: "format", url: "format" }, {}, { name: "duplicate", url: "duplicate" }]);
  });
  it("allows one url under both schemas", () => {
    expect(catalogErrors([{ name: "old", url: "/c" }, { name: "next", url: "/c", schemaVersion: "v2" }])).toEqual([{}, {}]);
  });
});

describe("nodes.gpus", () => {
  const stored: GPUSpec[] = [
    { vendor: "nvidia", resource: "nvidia.com/gpu", labelKey: "nvidia.com/gpu.product" },
    { vendor: "ascend", resource: "volcano.sh/Ascend910B4-1", labelKey: "volcano.sh/npu-name", products: [{ product: "Ascend-910B4", values: ["Ascend910B4-1", "910B4"] }] },
  ];
  const row = (p: Partial<GPURow>): GPURow => ({ ...emptyGPURow(), ...p });

  it("round-trips the stored table", () => {
    expect(gpuRows(stored)[1].products).toEqual([{ product: "Ascend-910B4", values: "Ascend910B4-1, 910B4" }]);
    expect(gpuTable(gpuRows(stored))).toEqual(stored);
  });

  it("keeps an emptied table as [], leaves out rows just added and keeps half-filled ones", () => {
    expect(gpuTable([])).toEqual([]);
    expect(gpuTable([emptyGPURow(), row({ products: [{ product: "", values: " , " }] })])).toEqual([]);
    expect(gpuTable([row({ vendor: "amd", products: [{ product: "", values: "x" }] })])).toEqual([
      { vendor: "amd", resource: "", labelKey: "", products: [{ product: "", values: ["x"] }] },
    ]);
  });

  it("applies swissd's rules", () => {
    const full = { vendor: "nvidia", labelKey: "k" };
    expect(
      gpuErrors([
        emptyGPURow(),
        row({ resource: "r" }),
        row({ ...full, resource: "a" }),
        row({ ...full, resource: "a" }),
        row({
          ...full,
          resource: "b",
          products: [
            { product: "A", values: "x" },
            { product: "A", values: "" },
            { product: "B", values: "x" },
            { product: "x", values: "" },
            { product: "", values: "y" },
          ],
        }),
      ]),
    ).toEqual([
      { products: [] },
      { vendor: "required", labelKey: "required", products: [] },
      { products: [] },
      { resource: "duplicate", products: [] },
      { products: [{}, { product: "duplicate" }, { values: "conflict" }, { product: "conflict" }, { product: "required" }] },
    ]);
    expect(hasGPUErrors(gpuErrors(gpuRows(stored)))).toBe(false);
  });

  it("checks one entry against the others, and a blank one as missing everything", () => {
    expect(gpuEntryErrors(row({ vendor: "ascend", resource: "nvidia.com/gpu", labelKey: "k" }), stored)).toEqual({ resource: "duplicate", products: [] });
    expect(gpuEntryErrors(gpuRows(stored)[1], [stored[0]])).toEqual({ products: [{}] });
    expect(gpuEntryErrors(emptyGPURow(), [])).toEqual({ vendor: "required", resource: "required", labelKey: "required", products: [] });
  });

  it("makes a vendor's entry its default by moving it first among the vendor's", () => {
    const rows = [{ vendor: "ascend" }, { vendor: "nvidia" }, { vendor: "ascend" }];
    expect([0, 1, 2].map((i) => isVendorDefault(rows, i))).toEqual([true, true, false]);
    expect(makeVendorDefault(rows, 2)).toEqual([rows[2], rows[0], rows[1]]);
    expect(makeVendorDefault(rows, 0)).toBe(rows);
  });

  it("groups entries by vendor, keeping each vendor's order and the entries' places", () => {
    const rows = [{ vendor: "ascend", resource: "a" }, { vendor: "nvidia", resource: "n" }, { vendor: "ascend", resource: "v" }];
    expect(vendorGroups(inOrder(rows, ["a", "n", "v"]))).toEqual([
      { vendor: "ascend", entries: [{ entry: rows[0], index: 0 }, { entry: rows[2], index: 2 }] },
      { vendor: "nvidia", entries: [{ entry: rows[1], index: 1 }] },
    ]);
  });

  it("keeps rows where they were when a default moves them, and puts new ones last", () => {
    const rows = [{ vendor: "ascend", resource: "a" }, { vendor: "ascend", resource: "v" }];
    const moved = makeVendorDefault(rows, 1);
    expect(inOrder(moved, ["a", "v"])).toEqual([{ entry: rows[0], index: 1 }, { entry: rows[1], index: 0 }]);
    expect(inOrder([...rows, { vendor: "amd", resource: "m" }, { vendor: "amd", resource: "x" }], ["x", "a", "v"]).map((p) => p.entry.resource)).toEqual(["x", "a", "v", "m"]);
  });
});

describe("feature defaults", () => {
  it("reads unset as on", () => {
    expect(FEATURES.every((k) => featureOn(undefined, k))).toBe(true);
    expect(featureOn({ features: { scaler: false } }, "scaler")).toBe(false);
  });

  it("stores off as false and on as unset", () => {
    const off = withFeature(undefined, "scaler", false);
    expect(off).toEqual({ features: { scaler: false } });
    expect(withFeature(off, "cart", false)).toEqual({ features: { scaler: false, cart: false } });
    expect(withFeature(off, "scaler", true)).toBeUndefined();
  });

  it("keeps an explicit true it did not touch", () => {
    expect(withFeature({ features: { cart: true } }, "scaler", false)).toEqual({ features: { cart: true, scaler: false } });
  });
});

describe("presets", () => {
  const presets = { a: { description: "A", values: { tolerations: [{ key: "x", operator: "Exists" }] } }, b: {} };

  it("round-trips a preset through its row", () => {
    const row = presetRow("a", presets.a);
    expect(row.values).toContain("tolerations:");
    expect(putPreset(presets, "a", row)).toEqual(presets);
  });

  it("flags a missing or taken name, YAML that does not parse, and values that are not a map", () => {
    expect(presetErrors(presetRow(" "), [])).toEqual({ name: "required" });
    expect(presetErrors({ ...presetRow("b"), values: "a: 1" }, ["b"]).name).toBe("duplicate");
    expect(presetErrors({ ...presetRow("c"), values: "a: [" }, []).values).toBe("yaml");
    expect(presetErrors({ ...presetRow("c"), values: "- a" }, []).values).toBe("map");
    expect(hasPresetErrors(presetErrors(presetRow("c"), []))).toBe(false);
  });

  it("renames, adds and removes", () => {
    expect(putPreset(presets, "b", { name: "c", description: "", values: "" })).toEqual({ a: presets.a, c: {} });
    expect(putPreset(presets, undefined, { name: " d ", description: " D ", values: "x: 1" })).toEqual({ ...presets, d: { description: "D", values: { x: 1 } } });
    expect(putPreset({ a: {} }, "a")).toBeUndefined();
  });
});
