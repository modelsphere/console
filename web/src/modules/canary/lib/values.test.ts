import { describe, expect, it } from "vitest";
import { isExactChartVersion, mergeLayers, stripOperatorOwned } from "./values";

describe("stripOperatorOwned", () => {
  it("removes only the three operator-owned enabled switches", () => {
    const { stripped, removed } = stripOperatorOwned({
      replicaCount: 2,
      scaler: { enabled: false, minReplicas: 1 },
      cart: { enabled: true },
      sloRequirement: { enabled: false, slo: "p99" },
    });
    expect(removed.sort()).toEqual([
      "cart.enabled",
      "scaler.enabled",
      "sloRequirement.enabled",
    ]);
    expect(stripped.replicaCount).toBe(2);
    expect(stripped.scaler).toEqual({ minReplicas: 1 });
    expect(stripped.cart).toBeUndefined();
    expect(stripped.sloRequirement).toEqual({ slo: "p99" });
  });
});

describe("mergeLayers", () => {
  it("applies last-writer-wins in swiss order", () => {
    const merged = mergeLayers({
      defaults: { replicaCount: 9, podAnnotations: { inherited: "yes" } },
      catalog: { extraArgs: ["--tp-size=8"], replicaCount: 1 },
      form: { replicaCount: 2 },
      edit: { extraArgs: ["--tp-size=8", "--mem-fraction-static=0.8"] },
    });
    expect(merged.replicaCount).toBe(2);
    expect(merged.podAnnotations).toEqual({ inherited: "yes" });
    expect(merged.extraArgs).toEqual([
      "--tp-size=8",
      "--mem-fraction-static=0.8",
    ]);
  });
});

describe("isExactChartVersion", () => {
  it("accepts pins and rejects helm ranges", () => {
    expect(isExactChartVersion("0.8.0")).toBe(true);
    expect(isExactChartVersion(">=0.7.1")).toBe(false);
    expect(isExactChartVersion("^0.8.0")).toBe(false);
  });
});
