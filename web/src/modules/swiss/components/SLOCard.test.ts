import { describe, expect, it } from "vitest";
import type { Plan, SLOConfig } from "@swiss/lib/api";
import { boundTypes, draftOf, editOf, pdEnabled } from "./SLOCard";

const pd: SLOConfig = {
  found: true,
  highPriority: false,
  minimumDeployment: { type: "pdengine", value: 2 },
  maximumDeployment: { type: "pdengine", value: 5 },
};

describe("SLO edit payload", () => {
  it("sends pdengine for both bounds when the release is in pd mode", () => {
    const body = editOf(draftOf(pd));
    expect(body.highPriority).toBe(false);
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toEqual({ type: "pdengine", value: 5 });
  });

  it("does not keep a replica ceiling on a pdengine floor", () => {
    const body = editOf(draftOf({
      found: true,
      minimumDeployment: { type: "pdengine", value: 2 },
      maximumDeployment: { type: "replica", value: 5 },
    }));
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toEqual({ type: "pdengine", value: 5 });
  });

  it("keeps a replica ceiling when the floor is replicas or concurrency", () => {
    const replicas = editOf(draftOf({
      found: true,
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 6 },
    }));
    expect(replicas.minimumDeployment).toEqual({ type: "replica", value: 1 });
    expect(replicas.maximumDeployment).toEqual({ type: "replica", value: 6 });

    const concurrency = editOf(draftOf({
      found: true,
      minimumDeployment: { type: "concurrency", value: 4 },
      maximumDeployment: { type: "replica", value: 8 },
    }));
    expect(concurrency.minimumDeployment).toEqual({ type: "concurrency", value: 4 });
    expect(concurrency.maximumDeployment).toEqual({ type: "replica", value: 8 });
  });

  it("omits an empty ceiling instead of inventing one", () => {
    const body = editOf(draftOf({ found: true, minimumDeployment: { type: "pdengine", value: 2 } }));
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toBeUndefined();
  });

  it("can send pdengine for both bounds when a pd release stored no floor", () => {
    expect(boundTypes(true)).toEqual(["pdengine", "replica"]);
    const draft = draftOf({ found: true });
    expect(draft.minType).toBe("replica");
    const body = editOf({ ...draft, minType: "pdengine", minValue: "2", maxValue: "4" });
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toEqual({ type: "pdengine", value: 4 });
  });

  it("keeps a stored replica floor on a pd release and can switch both bounds to pdengine", () => {
    const draft = draftOf({
      found: true,
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 4 },
    });
    expect(draft.minType).toBe("replica");
    expect(boundTypes(true)).toContain("pdengine");
    const kept = editOf(draft);
    expect(kept.minimumDeployment).toEqual({ type: "replica", value: 1 });
    expect(kept.maximumDeployment).toEqual({ type: "replica", value: 4 });
    const switched = editOf({ ...draft, minType: "pdengine", minValue: "2", maxValue: "4" });
    expect(switched.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(switched.maximumDeployment).toEqual({ type: "pdengine", value: 4 });
  });

  it("keeps replica and concurrency when the release is not pd", () => {
    expect(boundTypes(false)).toEqual(["replica", "concurrency"]);
  });
});

describe("pd mode from the release plan", () => {
  const plan = (layers: Record<string, Record<string, unknown>>) => ({ layers }) as Plan;

  it("reads pd.enabled, and the last layer to set it wins", () => {
    expect(pdEnabled(undefined)).toBe(false);
    expect(pdEnabled(plan({ catalog: { pd: { enabled: true } } }))).toBe(true);
    expect(pdEnabled(plan({
      catalog: { pd: { enabled: true } },
      form: { pd: { enabled: false } },
    }))).toBe(false);
  });

  it("keeps an earlier pd.enabled when a later layer only sets a role", () => {
    expect(pdEnabled(plan({
      catalog: { pd: { enabled: true } },
      form: { pd: { prefill: { replicas: 2 } } },
    }))).toBe(true);
  });
});
