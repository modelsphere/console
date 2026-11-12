import { describe, expect, it } from "vitest";
import type { SLOConfig } from "@swiss/lib/api";
import { draftOf, editOf } from "./SLOCard";

const base = (over: Partial<SLOConfig>): SLOConfig => ({ found: true, ...over });

describe("SLO edit payload", () => {
  it("sends pdengine for both bounds when a pdengine floor had a replica ceiling", () => {
    const body = editOf(draftOf(base({
      highPriority: false,
      minimumDeployment: { type: "pdengine", value: 2 },
      maximumDeployment: { type: "replica", value: 5 },
    })));
    expect(body.highPriority).toBe(false);
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toEqual({ type: "pdengine", value: 5 });
  });

  it("sends replica for both bounds when the floor is replicas", () => {
    const body = editOf(draftOf(base({
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 6 },
    })));
    expect(body.minimumDeployment).toEqual({ type: "replica", value: 1 });
    expect(body.maximumDeployment).toEqual({ type: "replica", value: 6 });
  });

  it("sends the type the user switched to on both bounds", () => {
    const draft = draftOf(base({
      minimumDeployment: { type: "replica", value: 1 },
      maximumDeployment: { type: "replica", value: 4 },
    }));
    const body = editOf({ ...draft, minType: "pdengine" });
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 1 });
    expect(body.maximumDeployment).toEqual({ type: "pdengine", value: 4 });
  });

  it("keeps a replica ceiling when the floor is concurrency", () => {
    const body = editOf(draftOf(base({
      minimumDeployment: { type: "concurrency", value: 4 },
      maximumDeployment: { type: "replica", value: 8 },
    })));
    expect(body.minimumDeployment).toEqual({ type: "concurrency", value: 4 });
    expect(body.maximumDeployment).toEqual({ type: "replica", value: 8 });
  });

  it("omits an empty ceiling", () => {
    const body = editOf(draftOf(base({ minimumDeployment: { type: "pdengine", value: 2 } })));
    expect(body.minimumDeployment).toEqual({ type: "pdengine", value: 2 });
    expect(body.maximumDeployment).toBeUndefined();
  });
});
