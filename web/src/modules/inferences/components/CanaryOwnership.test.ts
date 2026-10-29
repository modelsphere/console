import { describe, expect, it } from "vitest";
import type { CanaryOwner } from "@swiss/lib/api";
import type { ExperimentSummary } from "@/modules/canary/types";
import { matchingExperiment } from "./CanaryOwnership";

describe("Canary ownership links", () => {
  const owner: CanaryOwner = { apiVersion: "canary.modelsphere.dev/v1alpha1", kind: "LLMCanary", namespace: "canary", name: "demo", uid: "old-uid", verified: true };
  const record = (uid: string, namespace = "canary") => ({ id: uid, name: "demo", namespace, uid }) as ExperimentSummary;

  it("links the original UID after an experiment of the same name is recreated", () => {
    expect(matchingExperiment(owner, [record("new-uid"), record("old-uid")])?.id).toBe("old-uid");
  });
  it("keeps missing, inconsistent and cross-namespace ownership unlinked", () => {
    expect(matchingExperiment(owner, [record("new-uid")])).toBeUndefined();
    expect(matchingExperiment(owner, [record("old-uid", "other")])).toBeUndefined();
    expect(matchingExperiment({ ...owner, verified: false }, [record("old-uid")])).toBeUndefined();
    expect(matchingExperiment({ ...owner, uid: "" }, [record("")])).toBeUndefined();
  });
});
