import { describe, expect, it } from "vitest";
import type { SLOConfig } from "@swiss/lib/api";
import { draftOf, editOf } from "./SLOCard";

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
});
