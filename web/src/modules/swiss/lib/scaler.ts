import type { Condition } from "@swiss/lib/api";

const of = (conditions: Condition[] | undefined, type: string) => conditions?.find((c) => c.type === type);

// Only AbleToScale=False or ScalingActive=False (DecisionAvailable on operator 0.5.0) is a scaler failure.
export function scalerFailing(conditions?: Condition[]): Condition | undefined {
  return [of(conditions, "AbleToScale"), of(conditions, "ScalingActive") ?? of(conditions, "DecisionAvailable")].find(
    (c) => c?.status === "False",
  );
}

// AbleToScale=True reasons that hold a step. Synced and DeferralTimedOut are a normal scale.
const HOLD_REASONS = new Set(["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"]);

export function scalerHold(conditions?: Condition[]): string | undefined {
  const able = of(conditions, "AbleToScale");
  return able?.status === "True" && able.reason && HOLD_REASONS.has(able.reason) ? able.reason : undefined;
}

// ScalingLimited is informational; DecisionAvailable only mirrors ScalingActive when that is present.
export function scalerNeutral(conditions?: Condition[]): string[] {
  return of(conditions, "ScalingActive") ? ["ScalingLimited", "DecisionAvailable"] : ["ScalingLimited"];
}
