import { describe, expect, it } from "vitest";
import { aliasErrors, aliasMap, aliasRows, catalogErrors, FEATURES, featureOn, withFeature } from "./profile";

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

describe("gpu product aliases", () => {
  it("round-trips the stored map, one row per selector", () => {
    const stored = { "Ascend-910B3": ["accelerator=huawei-Ascend910", "vendor=huawei,model=910b"], H20: ["gpu=h20"] };
    expect(aliasRows(stored)).toHaveLength(3);
    expect(aliasMap(aliasRows(stored))).toEqual(stored);
  });

  it("leaves out a row just added, and keeps a half-filled one to be refused", () => {
    expect(aliasMap([{ product: "", selector: "" }])).toBeUndefined();
    expect(aliasMap([{ product: " A ", selector: "" }, { product: "", selector: "x=1" }])).toEqual({ A: [""], "": ["x=1"] });
  });

  it("applies swissd's selector rules", () => {
    expect(
      aliasErrors([
        { product: "", selector: "" },
        { product: "", selector: "a=1" },
        { product: "A", selector: "" },
        { product: "A", selector: "accelerator" },
        { product: "A", selector: "a=1,a=2" },
        { product: "A", selector: "a=1, b = 2" },
      ]),
    ).toEqual([{}, { product: "required" }, { selector: "required" }, { selector: "format" }, { selector: "format" }, {}]);
  });

  it("refuses two products one node could match with as many pairs", () => {
    expect(aliasErrors([{ product: "A", selector: "a=1" }, { product: "B", selector: "b=1" }])).toEqual([{ selector: "conflict" }, { selector: "conflict" }]);
    // More pairs wins, values that differ cannot both match, and one product may repeat itself.
    expect(aliasErrors([{ product: "A", selector: "a=1" }, { product: "B", selector: "a=1,b=1" }])).toEqual([{}, {}]);
    expect(aliasErrors([{ product: "A", selector: "a=1" }, { product: "B", selector: "a=2" }])).toEqual([{}, {}]);
    expect(aliasErrors([{ product: "A", selector: "a=1" }, { product: "A", selector: "b=1" }])).toEqual([{}, {}]);
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
