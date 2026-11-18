import { describe, expect, it } from "vitest";
import type { ObjectResult } from "@swiss/lib/api";
import { videoScalerStep } from "./DeploymentDetail";

const obj = (kind: string, name: string, spec: object, status?: object) => ({ ref: { kind, name }, live: { spec, status } }) as unknown as ObjectResult;
const slo = (pool: string, max?: number) => obj("JobSLORequirement", `h3-${pool}`, { serviceId: `h3-${pool}`, ...(max ? { maximumDeployment: { type: "replica", value: max } } : {}) });
const unavailable = { conditions: [{ type: "DecisionAvailable", status: "False", reason: "DecisionUnavailable", message: "no decision" }] };
const steady = { currentReplicas: 1, desiredReplicas: 1, conditions: [{ type: "DecisionAvailable", status: "True", reason: "DecisionReceived" }] };
const scaler = (pool: string, status: object) => obj("LLMScaler", `h3-${pool}`, { customProvider: { serviceId: `h3-${pool}` } }, status);

describe("videoScalerStep", () => {
  it("is off when no pool has a maximum, though each pool's scaler has no decision", () => {
    expect(videoScalerStep([slo("fl2va"), slo("ref2va"), scaler("fl2va", unavailable), scaler("ref2va", unavailable)])).toMatchObject({ state: "off" });
  });

  it("reads the scaled pools only, the worst of them", () => {
    expect(videoScalerStep([slo("fl2va"), slo("ref2va", 2), scaler("fl2va", unavailable), scaler("ref2va", steady)])).toMatchObject({ state: "ok" });
    expect(videoScalerStep([slo("fl2va", 2), slo("ref2va", 2), scaler("fl2va", unavailable), scaler("ref2va", steady)]).state).toBe("bad");
  });
});
