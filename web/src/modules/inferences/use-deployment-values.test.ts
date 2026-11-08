import { afterEach, expect, it, vi } from "vitest";
import { deployApi, type Plan } from "@swiss/lib/api";
import { EMPTY } from "./deployment-settings";
import { recoverySettings } from "./recovery";
import { readDeploymentValues } from "./use-deployment-values";
import { parseValues } from "./override-yaml";

afterEach(() => vi.restoreAllMocks());

it("uses the validated plan for baseline and effective values without discarding required inputs", async () => {
  const plan: Plan = {
    apiVersion: "plan.swiss/v1", release: { name: "model", namespace: "models" },
    source: { model: "weights", version: "1", variant: "gpu" }, chart: { name: "sglang", version: "0.9.32" }, engine: "sglang", profile: "site", hash: "saved",
    layers: { defaults: { cart: { enabled: false } }, catalog: { replicaCount: 1 }, site: { custom: true }, form: { requiredEndpoint: "storage:5000" }, edit: { replicaCount: 2 }, autoscale: { replicaCount: 4 } },
  };
  const compose = vi.spyOn(deployApi, "plan").mockImplementation(async (request) => {
    if (!request.overrides?.requiredEndpoint) throw new Error("Required input is missing");
    return plan;
  });
  const dump = vi.spyOn(deployApi, "helmValues").mockResolvedValue({ defaults: "replicaCount: 1\ncart:\n  enabled: true\n", overrides: "replicaCount: 4\ncart:\n  enabled: false\nrequiredEndpoint: storage:5000\n" });
  const preview = await readDeploymentValues({ model: "weights", fromRelease: "model", overrides: { requiredEndpoint: "storage:5000" } }, "replicaCount: 2\n", undefined, { form: EMPTY, recovery: recoverySettings() });
  expect(compose).toHaveBeenCalledTimes(1);
  expect(dump.mock.calls[0][0]).toMatchObject({ fromRelease: "model", overrides: plan.layers.form });
  expect(parseValues(preview.baseline)).toEqual({ replicaCount: 1, cart: { enabled: false }, custom: true });
  expect(parseValues(preview.effective)).toEqual({ replicaCount: 4, cart: { enabled: false }, requiredEndpoint: "storage:5000" });
});
