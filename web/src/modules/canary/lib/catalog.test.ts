import { describe, expect, it } from "vitest";
import { changeArmCatalog, defaultCatalog } from "./catalog";
import type { ArmDraft } from "../types";

describe("arm catalog selection", () => {
  it("prefers upstreamv2 even when another catalog is the environment default", () => {
    expect(defaultCatalog([
      { name: "upstream", schema: "v1" },
      { name: "inner", schema: "v2", default: true },
      { name: "upstreamv2", schema: "v2" },
    ])).toBe("upstreamv2");
  });

  it("uses a supported environment default or first supported catalog when upstreamv2 is absent", () => {
    expect(defaultCatalog([{ name: "old", schema: "v1", default: true }, { name: "inner", schema: "v2" }])).toBe("inner");
    expect(defaultCatalog([{ name: "first", schema: "v2" }, { name: "inner", schema: "v2", default: true }])).toBe("inner");
    expect(defaultCatalog([{ name: "old", schema: "v1" }])).toBe("");
    expect(defaultCatalog([])).toBe("");
  });

  it("clears source-specific configuration even when both catalogs contain the same model and variant names", () => {
    const arm: ArmDraft = {
      name: "baseline", replicaCount: 2, pricingKey: "custom",
      source: { catalog: "upstreamv2", model: "same-model", variant: "same-variant", version: "1.0.0", digest: "sha256:old" },
      chart: { name: "sglang", version: "0.8.0" },
      layers: { catalog: { model: { gpus: 8 } }, form: { replicaCount: 2 }, edit: { image: { tag: "old" } } },
    };
    const switched = changeArmCatalog(arm, "inner");
    expect(switched.source).toEqual({ catalog: "inner", model: "", variant: "", version: "" });
    expect(switched.chart).toEqual({ name: "", version: "" });
    expect(switched.layers).toEqual({ form: { replicaCount: 2 } });
    expect(switched).toMatchObject({ name: "baseline", replicaCount: 2, pricingKey: "custom" });
    expect(arm.source?.catalog).toBe("upstreamv2");
    expect(arm.layers.edit).toBeDefined();
  });
});
