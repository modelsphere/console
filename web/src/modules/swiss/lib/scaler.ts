import type { Condition, LLMScalerStatus } from "@swiss/lib/api";

export type ScalerHealth =
  | { kind: "failing"; reason: string }
  | { kind: "deferred"; reason: string }
  | { kind: "ok" };

function condition(status: LLMScalerStatus | undefined, type: string): Condition | undefined {
  return status?.conditions?.find((c) => c.type === type);
}

function reason(c: Condition): string {
  return c.reason || c.type;
}

// Older operators publish no Ready condition. DecisionAvailable=False is the
// only failure there; ScalingDeferred=False means nothing is held.
export function scalerHealth(status?: LLMScalerStatus): ScalerHealth {
  const ready = condition(status, "Ready");
  if (ready?.status === "False") return { kind: "failing", reason: reason(ready) };
  if (!ready) {
    const decision = condition(status, "DecisionAvailable");
    if (decision?.status === "False") return { kind: "failing", reason: reason(decision) };
  }
  const deferred = condition(status, "ScalingDeferred");
  if (deferred?.status === "True") return { kind: "deferred", reason: reason(deferred) };
  return { kind: "ok" };
}
