import type { Plan, PlanRequest } from "@swiss/lib/api";
import { layersOf } from "@swiss/components/Provenance";

export interface RecoverySettings {
  enabled: boolean;
  configured: boolean;
  model: string;
  idleTimeout: string;
  bufferToolCalls: boolean;
  resumeEnabled: boolean;
}

type Tree = Record<string, unknown>;
const object = (value: unknown): Tree => value && typeof value === "object" && !Array.isArray(value) ? value as Tree : {};

export function mergeValues(...layers: (Tree | undefined)[]): Tree {
  const result: Tree = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      result[key] = value && typeof value === "object" && !Array.isArray(value)
        ? mergeValues(object(result[key]), value as Tree)
        : value;
    }
  }
  return result;
}

export function planValues(plan: Plan): Tree {
  return mergeValues(...layersOf(plan).map((key) => plan.layers[key]));
}

export function recoverySettings(values: Tree = {}): RecoverySettings {
  const gateway = object(values.continuationGateway);
  const config = object(gateway.config);
  return {
    enabled: gateway.enabled === true,
    configured: Object.keys(gateway).length > 0,
    model: typeof config.continuationModel === "string" ? config.continuationModel : "",
    idleTimeout: config.stallIdleTimeoutSeconds == null ? "" : String(config.stallIdleTimeoutSeconds),
    bufferToolCalls: typeof config.bufferToolCalls === "boolean" ? config.bufferToolCalls : true,
    resumeEnabled: config.continuationEnabled !== false,
  };
}

export function withRecovery(request: PlanRequest, settings: RecoverySettings): PlanRequest {
  if (!settings.enabled && !settings.configured) return request;
  const gateway: Tree = { enabled: settings.enabled };
  if (settings.enabled) {
    const config: Tree = {
      continuationModel: settings.model.trim(),
      continuationEnabled: settings.resumeEnabled,
      bufferToolCalls: settings.bufferToolCalls,
    };
    if (settings.idleTimeout.trim()) config.stallIdleTimeoutSeconds = Number(settings.idleTimeout);
    gateway.config = config;
  }
  return { ...request, overrides: { ...request.overrides, continuationGateway: gateway } };
}

export type RecoveryError = "chart" | "cart" | "route" | "model" | "timeout" | "engine" | "overridden";

function supportedChart(chart: Plan["chart"]): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(chart.version);
  const minimum = chart.name === "sglang" ? [0, 8, 11] : chart.name === "vllm" ? [0, 8, 9] : undefined;
  if (!match || !minimum) return false;
  const version = match.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

export function recoveryInputError(settings: RecoverySettings): "model" | "timeout" | undefined {
  if (!settings.enabled) return;
  if (!settings.model.trim()) return "model";
  if (settings.idleTimeout.trim() && (!Number.isFinite(Number(settings.idleTimeout)) || Number(settings.idleTimeout) <= 0)) return "timeout";
}

function matchesRecovery(actual: RecoverySettings, expected: RecoverySettings): boolean {
  if (actual.enabled !== expected.enabled) return false;
  if (!expected.enabled) return true;
  return actual.model.trim() === expected.model.trim()
    && actual.resumeEnabled === expected.resumeEnabled
    && actual.bufferToolCalls === expected.bufferToolCalls
    && (!expected.idleTimeout.trim() || Number(actual.idleTimeout) === Number(expected.idleTimeout));
}

export function recoveryError(plan: Plan, expected?: RecoverySettings): RecoveryError | undefined {
  const values = planValues(plan);
  const gateway = object(values.continuationGateway);
  const actual = recoverySettings(values);
  if (actual.configured && !supportedChart(plan.chart)) return "chart";
  if (expected && !matchesRecovery(actual, expected)) return "overridden";
  if (gateway.enabled !== true) return;
  if (object(values.cart).enabled !== true) return "cart";
  if (object(values.modelRoute).enabled !== true) return "route";
  const config = object(gateway.config);
  if (typeof config.continuationModel !== "string" || !config.continuationModel.trim()) return "model";
  const timeout = config.stallIdleTimeoutSeconds;
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)) return "timeout";
  if (config.continuationEngine !== undefined && config.continuationEngine !== plan.chart.name) return "engine";
}
