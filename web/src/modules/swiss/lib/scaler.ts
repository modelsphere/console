import type { Condition, LLMScalerStatus } from "@swiss/lib/api";

export type ScalerHealth =
  | { kind: "failing"; reason: string }
  | { kind: "deferred"; reason: string }
  | { kind: "ok" };

// AbleToScale=True with one of these means a guard is holding the write.
const HOLD_REASONS = new Set(["RolloutInProgress", "ScaleDownSettling"]);

function condition(status: LLMScalerStatus | undefined, type: string): Condition | undefined {
  return status?.conditions?.find((c) => c.type === type);
}

function reason(c: Condition): string {
  return c.reason || c.type;
}

// Older operators publish neither Ready nor AbleToScale: DecisionAvailable=False
// is the only failure there, and ScalingDeferred=True (not False) is a hold.
export function scalerHealth(status?: LLMScalerStatus): ScalerHealth {
  const ready = condition(status, "Ready");
  if (ready?.status === "False") return { kind: "failing", reason: reason(ready) };
  const able = condition(status, "AbleToScale");
  if (able?.status === "False") return { kind: "failing", reason: reason(able) };
  if (!ready) {
    const decision = condition(status, "DecisionAvailable");
    if (decision?.status === "False") return { kind: "failing", reason: reason(decision) };
  }
  if (able) {
    if (able.status === "True" && able.reason && HOLD_REASONS.has(able.reason)) return { kind: "deferred", reason: able.reason };
    return { kind: "ok" };
  }
  const deferred = condition(status, "ScalingDeferred");
  if (deferred?.status === "True") return { kind: "deferred", reason: reason(deferred) };
  return { kind: "ok" };
}
