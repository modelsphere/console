import { describe, expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
import { assertProductionBinding, ProductionBindingChangedError } from "./production-binding";

const plan: Plan = {
  apiVersion: "plan.swiss/v1", release: { name: "model", namespace: "production" },
  source: { model: "weights", variant: "gpu", version: "1.0.0" },
  chart: { name: "vllm", version: "0.8.20" }, engine: "vllm", profile: "site", hash: "live",
  layers: {
    catalog: { service: { port: 8000 }, modelRoute: { enabled: true } },
    site: { modelRoute: { nginx: { service: "gateway/entry" } } },
    form: { replicaCount: 2, scaler: { enabled: true }, modelRoute: { nginx: { route: "inference", values: { adaptive_cc: "true" } } } },
  },
};

describe("referenced production upgrade", () => {
  it("permits model upgrades, replica/scaler settings and adaptive concurrency without changing bindings", () => {
    const changed = structuredClone(plan);
    changed.source.version = "2.0.0";
    changed.layers.form.replicaCount = 4;
    changed.layers.form.scaler = { enabled: false };
    changed.layers.edit = { modelRoute: { nginx: { values: { adaptive_cc: "false" } } } };
    expect(() => assertProductionBinding(plan, changed)).not.toThrow();
  });
  it.each([
    { modelRoute: { enabled: false } },
    { modelRoute: { name: "new-route" } },
    { modelRoute: { nginx: { route: "another-prefix" } } },
    { modelRoute: { nginx: { service: "other/entry" } } },
    { service: { port: 9000 } },
    { serviceId: "new-name" },
    { modelRoute: { nginx: null } },
  ])("rejects binding changes even when introduced through YAML overrides: %j", (override) => {
    const changed = structuredClone(plan);
    changed.layers.edit = override;
    expect(() => assertProductionBinding(plan, changed)).toThrow(ProductionBindingChangedError);
  });
  it("requires stopping before changing chart templates or release identity", () => {
    expect(() => assertProductionBinding(plan, { ...plan, chart: { ...plan.chart, version: "0.9.0" } })).toThrow(ProductionBindingChangedError);
    expect(() => assertProductionBinding(plan, { ...plan, release: { ...plan.release, namespace: "other" } })).toThrow(ProductionBindingChangedError);
  });
  it("compares effective values and preserves lower-layer bindings when an override is deleted", () => {
    const before = structuredClone(plan);
    before.layers.form.service = { port: 9000 };
    const after = structuredClone(before);
    after.layers.edit = { service: { port: null } };
    expect(() => assertProductionBinding(before, after)).toThrow(ProductionBindingChangedError);
    const equivalent = structuredClone(plan);
    equivalent.layers.edit = { service: { port: 8000 } };
    expect(() => assertProductionBinding(plan, equivalent)).not.toThrow();
  });
});
