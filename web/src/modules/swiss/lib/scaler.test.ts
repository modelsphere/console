import { describe, expect, it } from "vitest";
import type { AutoscaleState, Condition, ObjectResult } from "@swiss/lib/api";
import { scalerFailing, scalerHold, scalerNeutral } from "@swiss/lib/scaler";
import { pdScaleStep, scalerStep } from "@swiss/routes/DeploymentDetail";

const c = (type: string, status: Condition["status"], reason?: string): Condition => ({ type, status, reason });

describe("scalerFailing", () => {
  it("does not treat ScalingLimited as a failure", () => {
    expect(scalerFailing([
      c("ScalingActive", "True", "DecisionReceived"),
      c("AbleToScale", "True", "Synced"),
      c("ScalingLimited", "False", "DesiredWithinRange"),
    ])).toBeUndefined();
  });
  it("fails on AbleToScale=False or ScalingActive=False", () => {
    expect(scalerFailing([c("AbleToScale", "False", "TargetNotFound")])?.reason).toBe("TargetNotFound");
    expect(scalerFailing([c("ScalingActive", "False", "InvalidSpec")])?.reason).toBe("InvalidSpec");
  });
  it("prefers AbleToScale when both are False", () => {
    expect(scalerFailing([c("ScalingActive", "False", "InvalidSpec"), c("AbleToScale", "False", "TargetWriteFailed")])?.reason)
      .toBe("TargetWriteFailed");
  });
  it("uses DecisionAvailable only when ScalingActive is absent", () => {
    expect(scalerFailing([c("DecisionAvailable", "False", "DecisionUnavailable")])?.reason).toBe("DecisionUnavailable");
    expect(scalerFailing([c("ScalingActive", "True", "MetricsAvailable"), c("DecisionAvailable", "False", "DecisionUnavailable")]))
      .toBeUndefined();
  });
});

describe("scalerHold", () => {
  it("returns the hold reason of AbleToScale=True", () => {
    for (const reason of ["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"])
      expect(scalerHold([c("AbleToScale", "True", reason)])).toBe(reason);
  });
  it("is undefined for a normal scale or a failure", () => {
    expect(scalerHold([c("AbleToScale", "True", "Synced")])).toBeUndefined();
    expect(scalerHold([c("AbleToScale", "True", "DeferralTimedOut")])).toBeUndefined();
    expect(scalerHold([c("AbleToScale", "False", "ScaleDownStabilized")])).toBeUndefined();
    expect(scalerHold(undefined)).toBeUndefined();
  });
});

describe("scalerNeutral", () => {
  it("mutes DecisionAvailable only next to ScalingActive", () => {
    expect(scalerNeutral([c("DecisionAvailable", "True", "DecisionReceived")])).toEqual([]);
    expect(scalerNeutral([c("ScalingActive", "True", "DecisionReceived")])).toEqual(["DecisionAvailable"]);
    expect(scalerNeutral(undefined)).toEqual([]);
  });
});

describe("scalerStep", () => {
  const result = { ref: { apiVersion: "v1", kind: "LLMScaler", name: "r" } } as ObjectResult;
  const step = (conditions: Condition[], cur = 1, want = 1) =>
    scalerStep({ result, spec: undefined, status: { currentReplicas: cur, desiredReplicas: want, conditions } });

  it("is steady with ScalingLimited=False", () => {
    expect(step([c("ScalingActive", "True", "DecisionReceived"), c("AbleToScale", "True", "Synced"), c("ScalingLimited", "False", "DesiredWithinRange")]))
      .toEqual({ label: "Scaling", state: "ok", detail: "1 replica, steady" });
  });
  it("fails on AbleToScale=False", () => {
    expect(step([c("ScalingActive", "True", "DecisionReceived"), c("AbleToScale", "False", "TargetNotFound")]))
      .toEqual({ label: "Scaling", state: "bad", detail: "TargetNotFound" });
  });
  it("reports a hold as steady", () => {
    for (const reason of ["RolloutInProgress", "ScaleDownSettling", "ScaleDownStabilized"]) {
      expect(step([c("ScalingActive", "True", "MetricsAvailable"), c("AbleToScale", "True", reason)], 3, 1))
        .toEqual({ label: "Scaling", state: "ok", detail: "3 replicas, steady" });
    }
  });
  it("lets a failure win over a hold", () => {
    expect(step([c("ScalingActive", "False", "DecisionUnavailable"), c("AbleToScale", "True", "ScaleDownStabilized")], 3, 1))
      .toEqual({ label: "Scaling", state: "bad", detail: "DecisionUnavailable" });
  });
  it("reads a healthy 0.5.0 object with DecisionAvailable=True", () => {
    expect(step([c("DecisionAvailable", "True", "DecisionReceived")], 2, 2))
      .toEqual({ label: "Scaling", state: "ok", detail: "2 replicas, steady" });
  });
  it("reads a Prometheus object with no conditions from its replicas", () => {
    expect(step([], 1, 3)).toEqual({ label: "Scaling", state: "wait", detail: "1 → 3 replicas" });
    expect(step([], 3, 3)).toEqual({ label: "Scaling", state: "ok", detail: "3 replicas, steady" });
  });
});

describe("pdScaleStep", () => {
  const st = (s: Partial<AutoscaleState>): AutoscaleState => ({ namespace: "models", release: "glm", enabled: true, current: 2, ...s });

  it("reads swissd's pass in slices", () => {
    expect(pdScaleStep(st({ outcome: "unchanged" }))).toEqual({ label: "PD autoscaling", state: "ok", detail: "2 slices, steady" });
    expect(pdScaleStep(st({ outcome: "scaled-down", current: 2, want: 1 }))).toEqual({ label: "PD autoscaling", state: "wait", detail: "2 → 1 slice" });
    expect(pdScaleStep(st({ outcome: "held", hold: "role-not-ready" }))).toEqual({ label: "PD autoscaling", state: "wait", detail: "2 slices, held: role-not-ready" });
    expect(pdScaleStep(st({ outcome: "error", error: "boom" }))).toEqual({ label: "PD autoscaling", state: "bad", detail: "boom" });
    expect(pdScaleStep(st({}))).toEqual({ label: "PD autoscaling", state: "wait", detail: "not evaluated yet" });
  });

  it("reads a pdengine pass that moves only the engines as scaling", () => {
    const pd = { current: { prefill: 2, decode: 1 }, want: { prefill: 3, decode: 1 } };
    expect(pdScaleStep(st({ outcome: "scaled-up", current: 1, want: 1, pd }))).toEqual({ label: "PD autoscaling", state: "wait", detail: "2P1D → 3P1D per slice" });
    expect(pdScaleStep(st({ outcome: "unchanged", current: 1, want: 1, pd: { ...pd, want: pd.current } }))).toEqual({ label: "PD autoscaling", state: "ok", detail: "1 slice, steady" });
  });
});
