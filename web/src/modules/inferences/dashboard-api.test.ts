import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDeploymentTimeline } from "./dashboard-api";
import { HISTORY_LIMIT, recordedTimeline } from "./dashboard-lib";

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

describe("deployment timeline API compatibility", () => {
  it("uses the complete aggregate without downloading individual history rows", async () => {
    const data = recordedTimeline([], from, to, true);
    data.buckets[2].started = 601;
    fetchMock.mockResolvedValue(json(data));
    const result = await readDeploymentTimeline(now);
    expect(result.complete).toBe(true);
    expect(result.buckets[2].started).toBe(601);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/deploy/runs/timeline?from=");
  });
  it("supports the old server's run-id error and requests its actual 500-row limit", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "run id must be a number" }, 400))
      .mockResolvedValueOnce(json({ hasStore: true, runs: [] }));
    const result = await readDeploymentTimeline(now);
    expect(result.hasStore).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.buckets).toHaveLength(25);
    expect(String(fetchMock.mock.calls[1][0])).toContain("limit=500");
  });
  it("marks old capped data incomplete instead of returning a fake complete zero chart", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "not found" }, 404))
      .mockResolvedValueOnce(json({ hasStore: true, runs: Array.from({ length: HISTORY_LIMIT }, () => ({})) }));
    const result = await readDeploymentTimeline(now);
    expect(result.complete).toBe(false);
    expect(result.buckets).toEqual([]);
  });
  it("keeps a server without persistence distinct from zero operations", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "no database: this swissd keeps no operation log" }, 503))
      .mockResolvedValueOnce(json({ hasStore: false, runs: [] }));
    const result = await readDeploymentTimeline(now);
    expect(result.hasStore).toBe(false);
    expect(result.buckets).toEqual([]);
  });
  it.each([403, 500, 503])("does not mask unrelated HTTP %s failures", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "real backend failure" }, status));
    await expect(readDeploymentTimeline(now)).rejects.toThrow("real backend failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not treat malformed successful responses as valid history", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await expect(readDeploymentTimeline(now)).rejects.toThrow("Invalid deployment timeline");
  });
});
