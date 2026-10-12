import { describe, expect, it } from "vitest";
import type { CatalogResponse, Run } from "@swiss/lib/api";
import { HISTORY_LIMIT, recordedTimeline, supportedTotals, timelineTotals } from "./dashboard-lib";

const from = "2026-10-10T12:15:00.000Z";
const to = "2026-10-11T12:15:00.000Z";
const run = (id: number, startedAt: string, action = "install", extra: Partial<Run> = {}): Run => ({
  id,
  startedAt,
  endedAt: startedAt,
  action,
  namespace: "models",
  release: `model-${id}`,
  planHash: "hash",
  changed: true,
  ...extra,
});
const catalog: CatalogResponse = {
  name: "default",
  ref: "main",
  source: "https://catalog.example",
  index: {
    apiVersion: "catalog.swiss/v1",
    count: 1,
    models: [
      {
        name: "alpha",
        source: { hf: "org/alpha" },
        latest: "2",
        versions: [
          {
            version: "1",
            path: "alpha-1.yaml",
            digest: "old",
            variants: [{ id: "base", engine: "vllm", chart: { name: "vllm", version: "1" }, requires: { gpus: 1 } }],
          },
          {
            version: "2",
            path: "alpha-2.yaml",
            digest: "new",
            variants: [
              { id: "base", engine: "vllm", chart: { name: "vllm", version: "2" }, requires: { gpus: 1 } },
              { id: "tuned", engine: "sglang", chart: { name: "sglang", version: "2" }, requires: { gpus: 2 } },
            ],
          },
        ],
      },
    ],
  },
};

describe("supported catalog totals", () => {
  it("counts every supported version recipe, not a sample or only the latest", () =>
    expect(supportedTotals([catalog])).toEqual({ models: 1, recipes: 3 }));
  it("does not double-count mirrored catalog entries", () =>
    expect(supportedTotals([catalog, { ...catalog, name: "mirror" }])).toEqual({ models: 1, recipes: 3 }));
  it("does not count deprecated models as current support", () => {
    const old = {
      ...catalog,
      index: { ...catalog.index, models: catalog.index.models.map((m) => ({ ...m, deprecated: "retired" })) },
    };
    expect(supportedTotals([old])).toEqual({ models: 0, recipes: 0 });
  });
  it("distinguishes different model sources and recipe revisions", () => {
    const other = {
      ...catalog,
      index: { ...catalog.index, models: catalog.index.models.map((m) => ({ ...m, source: { hf: "other/alpha" } })) },
    };
    expect(supportedTotals([catalog, other])).toEqual({ models: 2, recipes: 6 });
  });
});

describe("recorded deployment timeline", () => {
  it("zero-fills a complete 24-hour window including partial edge hours", () => {
    const data = recordedTimeline([], from, to, true);
    expect(data.buckets).toHaveLength(25);
    expect(data.buckets[0].at).toBe("2026-10-10T12:00:00.000Z");
    expect(data.buckets.at(-1)?.at).toBe("2026-10-11T12:00:00.000Z");
    expect(timelineTotals(data)).toEqual({ started: 0, updated: 0, failed: 0 });
  });
  it("includes the start boundary and excludes the end and future records", () => {
    const data = recordedTimeline(
      [run(1, from), run(2, "2026-10-10T12:14:59Z"), run(3, to), run(4, "2026-10-11T13:00:00Z")],
      from,
      to,
      true,
    );
    expect(timelineTotals(data)?.started).toBe(1);
  });
  it("classifies starts updates rollbacks and failures and excludes no-op or unrelated operations", () => {
    const at = "2026-10-10T14:30:00Z";
    const data = recordedTimeline(
      [
        run(1, at),
        run(2, at, "apply"),
        run(3, at, "rollback"),
        run(4, at, "install", { error: "failed", changed: false }),
        run(5, at, "apply", { changed: false }),
        run(6, at, "diff"),
        run(7, at, "uninstall"),
      ],
      from,
      to,
      true,
    );
    expect(timelineTotals(data)).toEqual({ started: 1, updated: 2, failed: 1 });
    expect(data.buckets.find((b) => b.at.includes("14:00:00"))).toMatchObject({ started: 1, updated: 2, failed: 1 });
  });
  it("buckets offset timestamps by their actual UTC instant", () => {
    const data = recordedTimeline([run(1, "2026-10-10T16:30:00+02:00")], from, to, true);
    expect(data.buckets.find((b) => b.at === "2026-10-10T14:00:00.000Z")?.started).toBe(1);
  });
  it("never fabricates a zero curve when persistence is absent", () => {
    const data = recordedTimeline([], from, to, false);
    expect(data.buckets).toEqual([]);
    expect(timelineTotals(data)).toBeNull();
  });
  it("does not treat a capped history response as a complete day", () => {
    const data = recordedTimeline(
      Array.from({ length: HISTORY_LIMIT }, (_, i) => run(i, from)),
      from,
      to,
      true,
    );
    expect(data.complete).toBe(false);
    expect(data.buckets).toEqual([]);
    expect(timelineTotals(data)).toBeNull();
  });
  it("reports malformed relevant timestamps instead of silently hiding events", () =>
    expect(() => recordedTimeline([run(1, "bad-time")], from, to, true)).toThrow("timestamp"));
  it("rejects invalid or inverted time windows", () =>
    expect(() => recordedTimeline([], to, from, true)).toThrow("range"));
});
