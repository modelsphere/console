import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { Plan } from "@swiss/lib/api";
import { deploymentValues, deploymentYaml, matchesDeploymentYaml, parseDeploymentYaml, yamlPlanRequest } from "./deploy-yaml";

const plan: Plan = {
  apiVersion: "v1", hash: "original", engine: "vllm", profile: "site",
  source: { catalogName: "private", model: "model", variant: "gpu", version: "1.2.3" },
  chart: { name: "vllm", version: "0.8.9" }, release: { name: "model", namespace: "models" },
  layers: {
    defaults: { image: { repository: "example.com/engine", tag: "default" }, replicaCount: 1, flags: ["--default"], removable: true },
    catalog: { image: { tag: "catalog" }, flags: ["--catalog"] },
    form: { modelRoute: { enabled: true }, replicaCount: 2 },
    edit: { image: { tag: "custom" }, custom: { "key: with spaces": "override" } },
    autoscale: { replicaCount: 3 },
  },
};

describe("deployment YAML", () => {
  it("shows effective values in deployment layer order and round-trips YAML keys and scalar types", () => {
    const values = deploymentValues(plan);
    expect(values).toMatchObject({ image: { repository: "example.com/engine", tag: "custom" }, replicaCount: 3, flags: ["--catalog"] });
    expect(parseDeploymentYaml(deploymentYaml(plan))).toEqual(values);
  });

  it("keeps existing edits without copying inherited values into the edit layer on a no-op save", () => {
    const request = yamlPlanRequest({ model: "model" }, plan, deploymentYaml(plan));
    expect(parseDeploymentYaml(request.editsYAML!)).toEqual(plan.layers.edit);
    expect(request.overrides).toEqual(plan.layers.form);
  });

  it("sends nested changes, replaced arrays and removals while retaining existing edits", () => {
    const values = deploymentValues(plan);
    values.image = { repository: "example.com/changed", tag: "custom" };
    values.flags = ["--new"];
    delete values.removable;
    const request = yamlPlanRequest({}, plan, stringify(values));
    expect(parseDeploymentYaml(request.editsYAML!)).toEqual({
      image: { repository: "example.com/changed", tag: "custom" },
      custom: { "key: with spaces": "override" }, flags: ["--new"], removable: null,
    });
    expect(plan.layers.defaults.removable).toBe(true);
  });

  it("accepts removals represented by Helm null tombstones in the recomposed plan", () => {
    const values = deploymentValues(plan);
    delete values.removable;
    values.image = { repository: "example.com/engine" };
    const text = stringify(values);
    const request = yamlPlanRequest({}, plan, text);
    const composed = { ...plan, layers: { ...plan.layers, edit: parseDeploymentYaml(request.editsYAML!) } };
    expect(matchesDeploymentYaml(composed, text)).toBe(true);
    expect(matchesDeploymentYaml(composed, stringify({ ...values, removable: null }))).toBe(true);
    expect(deploymentValues(composed)).not.toHaveProperty("removable");
  });

  it("pins a reviewed upgrade to its resolved identity and retains upgrade state", () => {
    const request = yamlPlanRequest({ fromRelease: "model", version: "latest", catalog: "old", editsYAML: "stale: true" }, plan, deploymentYaml(plan));
    expect(request).toMatchObject({ fromRelease: "model", catalog: "private", model: "model", version: "1.2.3", variant: "gpu", chartVersion: "0.8.9", release: "model", namespace: "models" });
  });

  it("detects autoscale shadowing and underlying value drift after composition", () => {
    const values = deploymentValues(plan);
    expect(matchesDeploymentYaml(plan, stringify(values))).toBe(true);
    values.replicaCount = 9;
    expect(matchesDeploymentYaml(plan, stringify(values))).toBe(false);
  });

  it.each(["", "[]", "a: [", "a: 1\na: 2", "a: 1\n---\nb: 2", "!!set { a: null }", "a: !!set { b: null }", "a: .nan", "a: .inf", "a: &loop { recursive: *loop }"])("rejects invalid or non-mapping YAML: %s", (text) => {
    expect(() => parseDeploymentYaml(text)).toThrow();
  });
});
