import { describe, expect, it, vi } from "vitest";
import type { Plan, PlanRequest } from "@swiss/lib/api";
import { composeRecoveryPlan, composeRecoveryValuesRequest, RecoveryPlanChangedError } from "./recovery-compose";
import { EMPTY, planRequest } from "@swiss/components/DeploySettings";
import { composeAdaptivePlan } from "./adaptive-concurrency";
import { mergeValues, recoverySettings } from "./recovery";

const current: Plan = {
  apiVersion: "plan.swiss/v1", release: { name: "model", namespace: "models" },
  source: { model: "weights", variant: "gpu", version: "1.0", catalogName: "private" },
  chart: { name: "sglang", version: "0.9.32" }, engine: "sglang", profile: "site", hash: "original",
  layers: { form: { image: { repository: "example.com/engine", tag: "custom" }, continuationGateway: { enabled: true, replicas: 3, config: { continuationModel: "glm-5.3", stallIdleTimeoutSeconds: 45 } } } },
};
const cleared = { ...recoverySettings(current.layers.form), idleTimeout: "" };
const reset = () => {
  const copy = structuredClone(current);
  delete (copy.layers.form.continuationGateway as { config: { stallIdleTimeoutSeconds?: number } }).config.stallIdleTimeoutSeconds;
  return copy;
};

describe("recovery timeout reset", () => {
  it("removes a timeout retained by fromRelease without dropping unrelated settings", async () => {
    const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValueOnce(current).mockResolvedValueOnce(reset());
    const result = await composeRecoveryPlan({ fromRelease: "model" }, cleared, compose);
    expect(compose).toHaveBeenCalledTimes(2);
    const request = compose.mock.calls[1][0];
    expect(request).toMatchObject({ model: "weights", catalog: "private", release: "model", namespace: "models", chartVersion: "0.9.32" });
    expect(request.fromRelease).toBeUndefined();
    expect(request.overrides?.image).toEqual(current.layers.form.image);
    expect(request.overrides?.continuationGateway).toEqual({ enabled: true, replicas: 3, config: { continuationModel: "glm-5.3" } });
    expect(result).toEqual(reset());
    expect((current.layers.form.continuationGateway as { config: object }).config).toHaveProperty("stallIdleTimeoutSeconds", 45);
  });

  it("uses one compose for fresh installs and unchanged explicit timeouts", async () => {
    for (const [request, settings] of [[{}, cleared], [{ fromRelease: "model" }, recoverySettings(current.layers.form)]] as const) {
      const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValue(current);
      await composeRecoveryPlan(request, settings, compose);
      expect(compose).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects catalog, chart or unrelated configuration changes during reset", async () => {
    const changedSource = reset(); changedSource.source.version = "2.0";
    const changedChart = reset(); changedChart.chart.version = "0.9.33";
    const changedImage = reset(); changedImage.layers.form.image = { repository: "example.com/other" };
    for (const changed of [changedSource, changedChart, changedImage, current]) {
      const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValueOnce(current).mockResolvedValueOnce(changed);
      await expect(composeRecoveryPlan({ fromRelease: "model" }, cleared, compose)).rejects.toBeInstanceOf(RecoveryPlanChangedError);
    }
  });
});


it("clears both inherited adaptive fields and the timeout without changing other values", async () => {
  const form = { ...EMPTY, cart: true, modelRoute: true, adaptiveCc: false };
  const request = planRequest(form, { model: "weights", fromRelease: "model" });
  const retained = structuredClone(current);
  retained.layers.form = mergeValues(request.overrides, retained.layers.form, { modelRoute: { nginx: { values: { adaptive_cc_min: "80" } } } });
  const adaptiveCleaned = structuredClone(retained);
  delete (adaptiveCleaned.layers.form.modelRoute as { nginx: { values: Record<string, string> } }).nginx.values.adaptive_cc_min;
  const allCleaned = structuredClone(adaptiveCleaned);
  delete (allCleaned.layers.form.continuationGateway as { config: { stallIdleTimeoutSeconds?: number } }).config.stallIdleTimeoutSeconds;
  const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValueOnce(retained).mockResolvedValueOnce(adaptiveCleaned).mockResolvedValueOnce(allCleaned);
  const result = await composeRecoveryPlan(request, cleared, (next) => composeAdaptivePlan(next, form, null, compose));
  expect(compose).toHaveBeenCalledTimes(3);
  expect(compose.mock.calls[2][0].overrides).toEqual(allCleaned.layers.form);
  expect(result).toEqual(allCleaned);
});

it("previews the cleared upgrade timeout with pinned source and GPU options intact", async () => {
  const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValueOnce(current).mockResolvedValueOnce(reset());
  const request = await composeRecoveryValuesRequest({ fromRelease: "model", forceGpuProducts: true, editsYAML: "" }, cleared, compose);
  expect(compose).toHaveBeenCalledTimes(2);
  expect(request.fromRelease).toBeUndefined();
  expect(request).toMatchObject({ model: "weights", catalog: "private", version: "1.0", variant: "gpu", chartVersion: "0.9.32", forceGpuProducts: true, editsYAML: "" });
  expect(request.overrides).toEqual(reset().layers.form);
  expect(request.overrides?.continuationGateway).not.toHaveProperty("config.stallIdleTimeoutSeconds");
});
