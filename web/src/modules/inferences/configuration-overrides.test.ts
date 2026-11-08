import { expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
import { configurationOverrides } from "./configuration-overrides";

function plan(layers: Plan["layers"]): Plan {
  return { apiVersion: "plan.swiss/v1", release: { name: "example", namespace: "models" }, source: { model: "weights", variant: "default" }, chart: { name: "sglang", version: "0.9.32" }, engine: "sglang", profile: "site", hash: "fixture", layers };
}

it("reports only changed user values owned by later layers", () => {
  const requested = { replicaCount: 2, custom: "keep" };
  const composed = plan({ form: requested, edit: {}, autoscale: { replicaCount: 4 } });
  expect(configurationOverrides(composed, requested, { replicaCount: 4, custom: "keep" })).toEqual([{ path: "replicaCount", requested: 2, actual: 4, source: "autoscale" }]);
});

it("attributes a parent deletion to its winning system layer", () => {
  const requested = { modelRoute: { nginx: { route: "/weights" } } };
  const composed = plan({ form: requested, edit: {}, "canary-system": { modelRoute: { nginx: null } } });
  expect(configurationOverrides(composed, requested, {})).toEqual([{ path: "modelRoute.nginx.route", requested: "/weights", actual: undefined, source: "canary-system" }]);
});

it("shows a site policy only when it changes the user's value", () => {
  const requested = { modelRoute: { monitor: { enabled: true } } };
  const policy = { modelRoute: { monitor: { enabled: false } } };
  expect(configurationOverrides(plan({ form: policy }), requested, policy, policy)).toEqual([{ path: "modelRoute.monitor.enabled", requested: true, actual: false, source: "site" }]);
  expect(configurationOverrides(plan({ form: requested }), requested, requested, {})).toEqual([]);
});
