import { describe, expect, it } from "vitest";
import { scalerFailing } from "@swiss/components/ReleaseObjects";

describe("scalerFailing", () => {
  it("does not treat ScalingLimited as a failure", () => {
    expect(scalerFailing([
      { type: "ScalingActive", status: "True", reason: "DecisionReceived" },
      { type: "AbleToScale", status: "True", reason: "Synced" },
      { type: "ScalingLimited", status: "False", reason: "DesiredWithinRange" },
    ])).toBeUndefined();
  });
  it("fails on AbleToScale=False or ScalingActive=False", () => {
    expect(scalerFailing([{ type: "AbleToScale", status: "False", reason: "TargetNotFound" }])?.reason).toBe("TargetNotFound");
    expect(scalerFailing([{ type: "ScalingActive", status: "False", reason: "InvalidSpec" }])?.reason).toBe("InvalidSpec");
  });
  it("uses DecisionAvailable only when ScalingActive is absent", () => {
    expect(scalerFailing([{ type: "DecisionAvailable", status: "False", reason: "DecisionUnavailable" }])?.reason).toBe("DecisionUnavailable");
    expect(scalerFailing([
      { type: "ScalingActive", status: "True", reason: "MetricsAvailable" },
      { type: "DecisionAvailable", status: "False", reason: "DecisionUnavailable" },
    ])).toBeUndefined();
  });
});
