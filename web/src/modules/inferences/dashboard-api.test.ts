import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDeploymentTimeline } from "./dashboard-api";
import { HISTORY_LIMIT, timelineTotals } from "./dashboard-lib";

const from = "2026-10-10T12:15:00.000Z";
const to = "2026-10-11T12:15:00.000Z";
const now = Date.parse(to);
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { cookie: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("deployment history using published swissd APIs", () => {
  it("reads only the existing run log without probing an unmerged endpoint", async () => {
    fetchMock.mockResolvedValue(
      json({
        hasStore: true,
        runs: [
          {
            id: 1,
            namespace: "models",
            release: "example",
            action: "install",
            planHash: "hash",
            changed: true,
            startedAt: from,
            endedAt: from,
          },
        ],
      }),
    );
    const result = await readDeploymentTimeline(now);
    expect(result.hasStore).toBe(true);
    expect(result.complete).toBe(true);
    expect(timelineTotals(result)).toEqual({ started: 1, updated: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/deploy/runs?limit=${HISTORY_LIMIT}`);
  });

  it("zero-fills a known empty persisted history over the requested window", async () => {
    fetchMock.mockResolvedValue(json({ hasStore: true, runs: [] }));
    const result = await readDeploymentTimeline(now);
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
    expect(result.complete).toBe(true);
    expect(result.buckets).toHaveLength(25);
    expect(timelineTotals(result)).toEqual({ started: 0, updated: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks capped history incomplete instead of returning a fake complete zero chart", async () => {
    fetchMock.mockResolvedValue(json({ hasStore: true, runs: Array.from({ length: HISTORY_LIMIT }, () => ({})) }));
    const result = await readDeploymentTimeline(now);
    expect(result.complete).toBe(false);
    expect(result.buckets).toEqual([]);
    expect(timelineTotals(result)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a server without persistence distinct from zero operations", async () => {
    fetchMock.mockResolvedValue(json({ hasStore: false, runs: [] }));
    const result = await readDeploymentTimeline(now);
    expect(result.hasStore).toBe(false);
    expect(result.buckets).toEqual([]);
    expect(timelineTotals(result)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 500, 503])("does not hide HTTP %s failures with another endpoint request", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "real backend failure" }, status));
    await expect(readDeploymentTimeline(now)).rejects.toThrow("real backend failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ ok: true }, { hasStore: true }, { runs: [] }, { hasStore: true, runs: null }])(
    "rejects malformed history responses",
    async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(readDeploymentTimeline(now)).rejects.toThrow("Invalid deployment history response");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
