import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { path: string; body: unknown }[]);
vi.mock("@swiss/lib/host", () => ({
  apiPath: (p: string) => p,
  hostFetch: async (input: string, init?: RequestInit) => {
    sent.push({ path: input, body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: 200 });
  },
}));

const { deployApi } = await import("./api");

describe("deployApi applyFlags", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("rides the diff, the install and the apply", async () => {
    const flags = { skipSchemaValidation: true, createNamespace: true, forceConflicts: true };
    await deployApi.diff({ planHash: "h", applyFlags: flags });
    await deployApi.install("h", "why", "helm", flags);
    await deployApi.apply("h", 3, "why", flags);
    expect(sent).toEqual([
      { path: "/api/diff", body: { planHash: "h", applyFlags: flags } },
      { path: "/api/install", body: { planHash: "h", note: "why", applyWith: "helm", applyFlags: flags } },
      // The deprecated copy too, which is all a swissd older than applyFlags reads.
      { path: "/api/apply", body: { planHash: "h", expectRevision: 3, note: "why", forceConflicts: true, applyFlags: flags } },
    ]);
  });

  it("sends the deprecated forceConflicts on its own when asked", async () => {
    await deployApi.apply("h", 3, undefined, undefined, true);
    expect(sent[0].body).toEqual({ planHash: "h", expectRevision: 3, forceConflicts: true });
  });

  it("is left out when there are none", async () => {
    await deployApi.apply("h", 3);
    expect(sent[0].body).toEqual({ planHash: "h", expectRevision: 3 });
  });
});

describe("deployApi rollback applyFlags", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("rides the revision dry run and the rollback", async () => {
    const flags = { skipSchemaValidation: true };
    await deployApi.diffRevision("models", "r", 4, flags);
    await deployApi.rollback("models", "r", 4, 6, "why", flags);
    expect(sent).toEqual([
      { path: "/api/releases/models/r/revisions/4/diff", body: { applyFlags: flags } },
      { path: "/api/releases/models/r/rollback", body: { toRevision: 4, expectRevision: 6, note: "why", applyFlags: flags } },
    ]);
  });
});
