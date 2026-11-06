import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plan, PlanRequest } from "@swiss/lib/api";
import { EMPTY, planRequest } from "@swiss/components/DeploySettings";
import { composeAdaptivePlan } from "./adaptive-concurrency";
import { RecoveryFields } from "./components/RecoveryFields";
import { mergeValues, planValues, recoveryError, recoveryInputError, recoverySettings, withRecovery } from "./recovery";

const plan = (layers: Plan["layers"], chart = { name: "sglang", version: "0.8.11" }): Plan => ({
  apiVersion: "swiss.modelsphere.dev/v1alpha1", release: { name: "model", namespace: "models" },
  source: { model: "weights", variant: "default" }, chart, engine: chart.name, profile: "site", layers, hash: "hash",
});
const enabled = {
  cart: { enabled: true }, modelRoute: { enabled: true },
  continuationGateway: { enabled: true, config: { continuationModel: "glm-5.3", stallIdleTimeoutSeconds: 30 } },
};

describe("generation recovery deployment", () => {
  it("leaves old charts untouched until recovery is configured", () => {
    const request = planRequest(EMPTY, { model: "weights" });
    expect(withRecovery(request, recoverySettings())).toBe(request);
    expect(recoveryError(plan({ form: request.overrides! }, { name: "sglang", version: "0.8.0" }))).toBeUndefined();
  });

  it("writes actual model identity, positive timeout and execution settings through the existing plan endpoint", () => {
    const form = { ...EMPTY, modelRoute: true, cart: true };
    const settings = { ...recoverySettings(), enabled: true, model: " glm-5.3 ", idleTimeout: "45", bufferToolCalls: false };
    const request = withRecovery(planRequest(form, { model: "arbitrary-client-name" }), settings);
    expect(request.overrides?.continuationGateway).toEqual({ enabled: true, config: {
      continuationModel: "glm-5.3", continuationEnabled: true, stallIdleTimeoutSeconds: 45, bufferToolCalls: false,
    } });
    expect(recoveryError(plan({ form: request.overrides! }))).toBeUndefined();
  });

  it("seeds upgrades in merge order and preserves gateway values outside the form", () => {
    const current = plan({
      catalog: enabled,
      site: { continuationGateway: { replicas: 3, config: { stallIdleTimeoutSeconds: 60 } } },
      form: { continuationGateway: { config: { bufferToolCalls: false, continuationEnabled: false } } },
      edit: { continuationGateway: { config: { continuationModel: "kimi-k3" } } },
    });
    const settings = recoverySettings(planValues(current));
    expect(settings).toMatchObject({ enabled: true, configured: true, model: "kimi-k3", idleTimeout: "60", bufferToolCalls: false, resumeEnabled: false });
    const values = mergeValues(planValues(current), withRecovery({}, settings).overrides);
    expect(values.continuationGateway).toMatchObject({ replicas: 3, config: { continuationEnabled: false } });
  });

  it("explicitly disables a previously configured gateway without emitting active settings", () => {
    const settings = { ...recoverySettings(enabled), enabled: false };
    expect(withRecovery({}, settings).overrides?.continuationGateway).toEqual({ enabled: false });
  });

  it.each([
    ["sglang", "0.8.8", "chart"], ["sglang", "0.8.10", "chart"],
    ["vllm", "0.8.8", "chart"], ["other", "1.0.0", "chart"],
    ["sglang", "0.8.11", undefined], ["sglang", "0.9.22", undefined], ["vllm", "0.8.9", undefined],
  ])("checks the resolved %s %s chart", (name, version, error) => {
    expect(recoveryError(plan({ form: enabled }, { name, version }))).toBe(error);
  });

  it.each([
    [{ cart: { enabled: false } }, "cart"],
    [{ modelRoute: { enabled: false } }, "route"],
    [{ continuationGateway: { config: { continuationModel: " " } } }, "model"],
    [{ continuationGateway: { config: { stallIdleTimeoutSeconds: 0 } } }, "timeout"],
    [{ continuationGateway: { config: { stallIdleTimeoutSeconds: -1 } } }, "timeout"],
    [{ continuationGateway: { config: { stallIdleTimeoutSeconds: Infinity } } }, "timeout"],
    [{ continuationGateway: { config: { continuationEngine: "vllm" } } }, "engine"],
  ])("validates the final plan including higher-priority YAML overrides", (edit, error) => {
    expect(recoveryError(plan({ form: enabled, edit }))).toBe(error);
  });

  it("does not replace the chart timeout when the input is empty", () => {
    const request = withRecovery({}, { ...recoverySettings(enabled), idleTimeout: "" });
    expect(request.overrides?.continuationGateway).toMatchObject({ config: { continuationModel: "glm-5.3" } });
    expect((request.overrides?.continuationGateway as { config: object }).config).not.toHaveProperty("stallIdleTimeoutSeconds");
  });

  it("shows model identity and recovery controls only when enabled", () => {
    const off = renderToStaticMarkup(<RecoveryFields settings={recoverySettings()} onChange={() => {}} />);
    expect(off).toContain("生成中断恢复");
    expect(off).not.toContain("实际模型");
    const on = renderToStaticMarkup(<RecoveryFields settings={recoverySettings(enabled)} onChange={() => {}} />);
    expect(on).toContain("实际模型");
    expect(on).toContain('value="glm-5.3"');
    expect(on).toContain("缓冲工具调用");
  });
});

describe("recovery review regressions", () => {
  it("includes later plan layers when validating the final recovery configuration", () => {
    expect(recoveryError(plan({ form: enabled, autoscale: { cart: { enabled: false } } }))).toBe("cart");
  });

  it("rejects advanced YAML that overrides the operator's recovery choice", () => {
    const expected = { ...recoverySettings(enabled), enabled: false };
    expect(recoveryError(plan({ form: enabled }), expected)).toBe("overridden");
    expect(recoveryError(plan({ form: enabled }), { ...expected, enabled: true, model: "kimi-k3" })).toBe("overridden");
  });

  it("rejects disabled gateway values retained on a chart without that section", () => {
    expect(recoveryError(plan({ form: { continuationGateway: { enabled: false } } }, { name: "sglang", version: "0.8.0" }))).toBe("chart");
  });

  it("keeps intentional detection-only mode valid", () => {
    const settings = { ...recoverySettings(enabled), resumeEnabled: false };
    const request = withRecovery({}, settings);
    expect(recoveryError(plan({ form: { ...enabled, ...request.overrides } }), settings)).toBeUndefined();
  });
});


describe("recovery inputs and advanced overrides", () => {
  it("rejects invalid input before requesting a plan", () => {
    expect(recoveryInputError({ ...recoverySettings(), enabled: true })).toBe("model");
    for (const idleTimeout of ["0", "-1", "invalid", "Infinity"]) {
      expect(recoveryInputError({ ...recoverySettings(enabled), idleTimeout })).toBe("timeout");
    }
    expect(recoveryInputError({ ...recoverySettings(enabled), idleTimeout: "" })).toBeUndefined();
  });

  it("checks model, timeout and both execution switches after advanced YAML", () => {
    const expected = recoverySettings(enabled);
    for (const config of [{ continuationModel: "kimi-k3" }, { stallIdleTimeoutSeconds: 60 }, { bufferToolCalls: false }, { continuationEnabled: false }]) {
      expect(recoveryError(plan({ form: enabled, edit: { continuationGateway: { config } } }), expected)).toBe("overridden");
    }
    expect(recoveryError(plan({ form: enabled }), { ...expected, idleTimeout: "30.00" })).toBeUndefined();
  });
});


it("preserves recovery through both adaptive upgrade compositions", async () => {
  const form = { ...EMPTY, cart: true, modelRoute: true, adaptiveCc: false };
  const settings = recoverySettings(enabled);
  const request = withRecovery(planRequest(form, { model: "weights", fromRelease: "model" }), settings);
  const first = plan({ form: mergeValues(request.overrides, { modelRoute: { nginx: { values: { adaptive_cc_min: "80" } } } }) });
  const cleaned = plan({ form: request.overrides! });
  const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockResolvedValueOnce(first).mockResolvedValueOnce(cleaned);
  const result = await composeAdaptivePlan(request, form, null, compose);
  expect(compose).toHaveBeenCalledTimes(2);
  expect(compose.mock.calls[1][0].overrides?.continuationGateway).toEqual(request.overrides?.continuationGateway);
  expect(compose.mock.calls[1][0].fromRelease).toBeUndefined();
  expect(recoveryError(result, settings)).toBeUndefined();
});
