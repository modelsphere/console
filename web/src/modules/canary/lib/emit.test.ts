import { describe, expect, it } from "vitest";
import { emptyDraft, emitManifests, layersFromVariant } from "./emit";
import { catalogVariants } from "../fixtures/catalog-v2";
import { fixtureCanaries } from "../fixtures/canaries";
import { validateCanary, wizardStepComplete } from "./validate";
import type { ArmDraft } from "../types";

describe("emitManifests", () => {
  it("puts merged values on the CR without operator-owned enabled keys", () => {
    const variant =
      catalogVariants.find((v) => v.id === "sglang-tp8-h100-optimized") ??
      catalogVariants[0];
    const draft = emptyDraft();
    draft.name = "qwen-prod-canary";
    draft.targetRef = {
      kind: "HelmRelease",
      name: "qwen-prod",
      namespace: "llm-serving",
    };
    draft.gateway = {
      name: "openresty",
      namespace: "llm-route",
      hostname: "ai-cloud.example.com",
      sectionName: "https",
    };
    draft.traffic = { production: 90, canary: 10 };
    draft.route = {
      enabled: true,
      productionOpenrestyService: "openresty",
      path: "/qwen",
      forceHeader: { name: "x-canary", value: "force" },
    };
    draft.arms = [
      {
        name: "candidate",
        chart: {
          name: variant.chart.name,
          version: variant.resolvedChartVersion,
        },
        replicaCount: 1,
        source: {
          model: variant.model,
          version: variant.version,
          variant: variant.id,
        },
        layers: {
          ...layersFromVariant(variant, 1),
          edit: { scaler: { enabled: true }, extraArgs: ["--tp-size=8"] },
        },
      },
    ];
    const result = emitManifests(draft);
    expect(result.canary.apiVersion).toBe("canary.modelsphere.dev/v1alpha1");
    expect(result.yaml).not.toContain("canary.4pd.io");
    expect(result.issues).toEqual([]);
    expect(result.canary.spec.arms[0]?.values.scaler).toBeUndefined();
    expect(result.stripped.candidate).toContain("scaler.enabled");
    expect(result.yaml).toContain("kind: LLMCanary");
    expect(result.yaml).not.toContain("kind: ConfigMap");
    expect(result.canary.spec.traffic).toEqual({ production: 90, canary: 10 });
    expect(result.canary.spec.gateway).toEqual({
      name: "openresty",
      namespace: "llm-route",
      hostname: "ai-cloud.example.com",
      sectionName: "https",
    });
    expect(result.canary.spec.route).toMatchObject({
      enabled: true,
      path: "/qwen",
      productionOpenrestyService: "openresty",
      forceHeader: { name: "x-canary", value: "force" },
    });
    expect(result.yaml).toContain("path: /qwen");
    expect(result.yaml).toContain("enabled: true");
    expect(validateCanary(result.canary)).toEqual([]);
  });

  it("rejects a catalog arm until gateway, route, and traffic split are set", () => {
    const variant = catalogVariants[0];
    const arm: ArmDraft = {
      name: "candidate",
      chart: {
        name: variant.chart.name,
        version: variant.resolvedChartVersion,
      },
      replicaCount: 1,
      source: {
        model: variant.model,
        version: variant.version,
        variant: variant.id,
      },
      layers: layersFromVariant(variant, 1),
    };
    const draft = emptyDraft();
    draft.name = "qwen-prod-canary";
    draft.targetRef = {
      kind: "HelmRelease",
      name: "qwen-prod",
      namespace: "llm-serving",
    };
    draft.arms = [arm];
    draft.traffic = { production: 0, canary: 0 };
    expect(wizardStepComplete("arms", draft)).toBe(true);
    expect(wizardStepComplete("traffic", draft)).toBe(false);
    expect(wizardStepComplete("route", draft)).toBe(false);

    const bare = emitManifests(draft);
    const paths = bare.issues.map((issue) => issue.path);
    expect(paths).toContain("spec.traffic");
    expect(paths).toContain("spec.gateway.name");
    expect(paths).toContain("spec.gateway.namespace");
    expect(paths).toContain("spec.route.path");
    expect(paths).toContain("spec.route.productionOpenrestyService");
    expect(bare.canary.spec.arms).toHaveLength(1);
    expect(bare.canary.spec.route.enabled).toBe(true);

    draft.traffic = { production: 99, canary: 1 };
    draft.gateway = { name: "openresty", namespace: "llm-route" };
    draft.route = {
      enabled: false,
      productionOpenrestyService: "openresty",
      path: "/qwen",
      servicePort: 8080,
      forceHeader: { name: "", value: "" },
    };
    const ready = emitManifests(draft);
    expect(ready.issues).toEqual([]);
    expect(wizardStepComplete("traffic", draft)).toBe(true);
    expect(wizardStepComplete("route", draft)).toBe(true);
    expect(ready.canary.spec.route).toMatchObject({
      enabled: false,
      path: "/qwen",
      productionOpenrestyService: "openresty",
      servicePort: 8080,
    });
    expect(ready.canary.spec.traffic).toEqual({ production: 99, canary: 1 });
    expect(ready.yaml).toContain("enabled: false");
  });
});

describe("fixture canaries", () => {
  it("stores gateway, HTTPRoute path, route.enabled, and a traffic split", () => {
    expect(fixtureCanaries.length).toBeGreaterThan(0);
    for (const canary of fixtureCanaries) {
      expect(canary.spec.gateway.name).toBeTruthy();
      expect(canary.spec.gateway.namespace).toMatch(
        /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
      );
      expect(canary.spec.route.path).toMatch(/^\/.+/);
      expect(typeof canary.spec.route.enabled).toBe("boolean");
      expect(canary.spec.route.productionOpenrestyService).toBeTruthy();
      expect(
        canary.spec.traffic.production + canary.spec.traffic.canary,
      ).toBeGreaterThan(0);
      expect(validateCanary(canary)).toEqual([]);
    }
  });
});
