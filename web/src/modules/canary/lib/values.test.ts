import { describe, expect, it } from "vitest";
import { isExactChartVersion, mergeLayers, mergeObjects, canarySystemValues } from "./values";

describe("LLMService merge contract", () => {
 it("deletes null keys, replaces lists and applies the system layer last", () => {
  const base = { model: { gpus: 2, remove: true }, list: [1, 2], scaler: { enabled: true } };
  const values = mergeObjects(base, { model: { remove: null }, list: [3] });
  expect(values.model).toEqual({ gpus: 2 });
  expect(values.list).toEqual([3]);
  expect(base.model.remove).toBe(true);
  const final = mergeObjects(values, canarySystemValues({ name: "exp", namespace: "canary", route: { enabled: false, path: "/prod", productionOpenrestyService: "openresty", forceHeader: { name: "", value: "" } } }, "a"));
  expect(final.scaler).toEqual({ enabled: false });
  expect(final.cart).toEqual({ enabled: true, fullnameOverride: "exp-a-cart" });
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
    expect(isExactChartVersion("1.2.3-exp.1+build.2")).toBe(true);
    expect(isExactChartVersion("1.2.x")).toBe(false);
    expect(isExactChartVersion("1.2.3-")).toBe(false);
    expect(isExactChartVersion(">=0.7.1")).toBe(false);
    expect(isExactChartVersion("^0.8.0")).toBe(false);
  });
});
