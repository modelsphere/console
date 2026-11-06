import type { AutoscaleEngines, AutoscaleState, Condition } from "@swiss/lib/api";

// "2P1D": prefill and decode engines per slice.
export const engines = (e: AutoscaleEngines) => `${e.prefill}P${e.decode}D`;

// The engines a PD pass moves each slice to, when it moves them.
export function enginesMove(st: AutoscaleState): { cur: string; want: string } | undefined {
  const { current, want } = st.pd ?? {};
  if (!current || !want || (current.prefill === want.prefill && current.decode === want.decode)) return undefined;
  return { cur: engines(current), want: engines(want) };
}

const of = (conditions: Condition[] | undefined, type: string) => conditions?.find((c) => c.type === type);

// Only AbleToScale=False or ScalingActive=False (DecisionAvailable on operator 0.5.0) is a scaler failure.
export function scalerFailing(conditions?: Condition[]): Condition | undefined {
  return [of(conditions, "AbleToScale"), of(conditions, "ScalingActive") ?? of(conditions, "DecisionAvailable")].find(
    (c) => c?.status === "False",
  );
}

// AbleToScale=True reasons that hold a step. A hold reports as steady; only its AbleToScale
// condition is marked. Synced and DeferralTimedOut are a normal scale.
const HOLD_REASONS = new Set(["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"]);

export function scalerHold(conditions?: Condition[]): string | undefined {
  const able = of(conditions, "AbleToScale");
  return able?.status === "True" && able.reason && HOLD_REASONS.has(able.reason) ? able.reason : undefined;
}

// DecisionAvailable only mirrors ScalingActive when that is present.
export function scalerNeutral(conditions?: Condition[]): string[] {
  return of(conditions, "ScalingActive") ? ["DecisionAvailable"] : [];
}
