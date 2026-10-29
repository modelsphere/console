import { describe, expect, it } from "vitest";
import { productionTargets } from "../fixtures/deployments";
import { emptyDraft, emitManifests } from "./emit";
import { applyProductionTarget } from "./target";
import { validateCanary, wizardStepComplete } from "./validate";

const qwen = productionTargets.find((target) => target.name === "qwen-prod");
const kimi = productionTargets.find((target) => target.name === "kimi-prod");

describe("applyProductionTarget", () => {
  it("always takes environment-owned fields from the selected production release", () => {
    expect(qwen).toBeTruthy();
    expect(kimi).toBeTruthy();
    const filled = applyProductionTarget(emptyDraft(), qwen!);
    expect(filled.name).toBe("qwen-prod-canary");
    expect(filled.targetRef).toEqual({
      kind: "LLMService",
      name: "qwen-prod",
      namespace: "llm-serving",
    });
    expect(filled.gateway).toEqual({
      name: "openresty",
      namespace: "llm-route",
      hostname: "ai-cloud.example.com",
      sectionName: "https",
    });
    expect(filled.route.path).toBe("/qwen");
    expect(filled.route.productionOpenrestyService).toBe("openresty");

    const edited = {
      ...filled,
      gateway: { ...filled.gateway, name: "custom-gw" },
    };
    const kept = applyProductionTarget(edited, qwen!);
    expect(kept.gateway.name).toBe("openresty");
    expect(kept.gateway.namespace).toBe("llm-route");
    expect(kept.gateway.hostname).toBe("ai-cloud.example.com");

    const switched = applyProductionTarget(filled, kimi!);
    expect(switched.name).toBe("kimi-prod-canary");
    expect(switched.gateway.name).toBe("openresty");
    expect(switched.gateway.namespace).toBe("llm-route");
    expect(switched.gateway.hostname).toBeUndefined();
    expect(switched.gateway.sectionName).toBeUndefined();
    expect(switched.route.path).toBe("/kimi-k3");
  });

  it("keeps a name the user changed after selecting a production release", () => {
    const filled = applyProductionTarget(emptyDraft(), qwen!);
    const renamed = { ...filled, name: "my-experiment" };
    expect(applyProductionTarget(renamed, kimi!).name).toBe("my-experiment");
  });

  it("clears stale infrastructure fields when a new target lacks configuration", () => {
    const previous = applyProductionTarget(emptyDraft(), qwen!);
    previous.route.servicePort = 9999;
    const next = applyProductionTarget(previous, {
      kind: "HelmRelease",
      name: "unconfigured",
      namespace: "another-namespace",
    });
    expect(next.gateway).toEqual({ name: "", namespace: "" });
    expect(next.route.path).toBe("");
    expect(next.route.productionOpenrestyService).toBe("");
    expect(next.route.servicePort).toBeUndefined();
    expect(next.route.enabled).toBe(previous.route.enabled);
    expect(next.traffic).toEqual(previous.traffic);
    expect(wizardStepComplete("route", next)).toBe(false);
  });

  it("uses a different deployment environment without retaining test-cluster values", () => {
    const testDraft = applyProductionTarget(emptyDraft(), qwen!);
    const productionDraft = applyProductionTarget(testDraft, {
      kind: "HelmRelease",
      name: "production-release",
      namespace: "production-models",
      route: "production-model",
      gateway: {
        name: "production-gateway",
        namespace: "production-routing",
        hostname: "models.example.org",
        sectionName: "https",
      },
      openrestyService: "production-dispatch",
    });
    expect(productionDraft.targetRef.namespace).toBe("production-models");
    expect(productionDraft.gateway).toEqual({
      name: "production-gateway",
      namespace: "production-routing",
      hostname: "models.example.org",
      sectionName: "https",
    });
    expect(productionDraft.route.path).toBe("/production-model");
    expect(productionDraft.route.productionOpenrestyService).toBe("production-dispatch");
    expect(productionDraft.route.servicePort).toBeUndefined();
    expect(productionDraft.route.enabled).toBe(true);
    expect(productionDraft.route.forceHeader).toEqual({ name: "x-canary", value: "force" });
    const { canary } = emitManifests(productionDraft);
    expect(canary.spec.gateway).toEqual(productionDraft.gateway);
    expect(canary.spec.route).toEqual({
      enabled: true,
      path: "/production-model",
      productionOpenrestyService: "production-dispatch",
      forceHeader: { name: "x-canary", value: "force" },
    });
    expect(canary.spec.proxy).not.toHaveProperty("values");
  });
});

describe("gateway required fields", () => {
  it("blocks a blank gateway name or namespace in the wizard and on the CR", () => {
    const draft = applyProductionTarget(emptyDraft(), qwen!);
    draft.gateway = { name: "", namespace: "" };
    expect(wizardStepComplete("route", draft)).toBe(false);

    draft.gateway = { name: " ", namespace: "llm-route" };
    expect(wizardStepComplete("route", draft)).toBe(false);

    draft.gateway = { name: "openresty", namespace: " " };
    expect(wizardStepComplete("route", draft)).toBe(false);

    draft.gateway = { name: "openresty", namespace: "" };
    expect(wizardStepComplete("route", draft)).toBe(false);

    draft.gateway = { name: "openresty", namespace: "llm-route" };
    expect(wizardStepComplete("route", draft)).toBe(true);

    const blank = emptyDraft();
    blank.gateway = { name: " ", namespace: " " };
    const paths = emitManifests(blank).issues.map((issue) => issue.path);
    expect(paths).toContain("spec.gateway.name");
    expect(paths).toContain("spec.gateway.namespace");
    expect(
      validateCanary(emitManifests(blank).canary).map((issue) => issue.path),
    ).toEqual(
      expect.arrayContaining(["spec.gateway.name", "spec.gateway.namespace"]),
    );
  });
});
