import { describe, expect, it } from "vitest";
import {
  difference,
  format,
  rangeBounds,
  tpsPreview,
} from "./metric-presentation";
import { quotedRevenue } from "./quoted-revenue";
import { fixtureApi } from "./api";
import { emptyMetrics } from "./fixture-metrics";
import type { Metrics } from "../types";
const prices = {
  inputPerMillion: 10,
  cachedPerMillion: 1,
  outputPerMillion: 20,
};
const summary = {
  ...emptyMetrics,
  inputTPM: 1000000,
  outputTPM: 200000,
  cacheHit: 80,
};
describe("metrics dashboard calculations", () => {
  it("separates missing, measured zero, absolute and relative changes", () => {
    expect(difference(0, 10)).toEqual({ absolute: 10, relative: null });
    expect(difference(null, 10).absolute).toBeNull();
    expect(difference(50, 60)).toEqual({ absolute: 10, relative: 20 });
    expect(format(0)).toBe("0");
    expect(format(Infinity)).toBe("—");
    expect(format(0.0000001)).not.toBe("0");
  });
  it("uses a stopped experiment boundary for recent ranges", () => {
    const end = Date.parse("2026-10-20T08:00:00Z") / 1000;
    expect(
      rangeBounds({ stopAt: "2026-10-20T08:00:00Z" }, 3600, Date.now()),
    ).toEqual({ start: end - 3600, end });
  });
  it("repartitions input and keeps output fixed for quote bounds", () => {
    expect(quotedRevenue(summary, prices, 50, "fixed")).toMatchObject({
      applied: 50,
      input: 5,
      cached: 0.5,
      output: 4,
      minute: 9.5,
      hour: 570,
    });
    expect(quotedRevenue(summary, prices, 50, "lower")?.applied).toBe(80);
    expect(quotedRevenue(summary, prices, 50, "upper")?.applied).toBe(50);
    expect(
      quotedRevenue({ ...summary, cacheHit: null }, prices, 0, "lower"),
    ).toBeNull();
    expect(
      quotedRevenue({ ...summary, cacheHit: null }, prices, 0, "fixed")?.minute,
    ).toBe(14);
    expect(quotedRevenue(summary, prices, 100, "fixed")?.minute).toBe(5);
    expect(
      quotedRevenue(summary, { ...prices, inputPerMillion: -1 }, 50, "fixed"),
    ).toBeNull();
    expect(quotedRevenue(summary, null, 50, "fixed")).toBeNull();
    expect(quotedRevenue(summary, prices, NaN, "fixed")).toBeNull();
  });
  it("counts zero, includes threshold equality, excludes null/error minutes", () => {
    const data = {
      series: [0, 10, 20, null, NaN, 5].map((n, i) => ({
        time: i * 60,
        arms: { a: { overallTPS: n } },
        error: i === 5 ? "gap" : undefined,
      })),
    } as unknown as Metrics;
    expect(tpsPreview(data, "a", 10)).toMatchObject({
      evaluated: 3,
      failed: 1,
      pass: 200 / 3,
    });
    expect(tpsPreview(data, "missing", 10).pass).toBeNull();
  });
  it("clips historical fixture minutes and keeps token totals raw when normalizing", async () => {
    const e = await fixtureApi.experiments.get("fixture-0");
    const full = await fixtureApi.experiments.metrics(e.id);
    const end = Date.parse(e.stopAt!) / 1000;
    const last = await fixtureApi.experiments.metrics(e.id, end - 600, end);
    expect(last.series).toHaveLength(10);
    expect(last.eligibleMinutes).toBe(10);
    expect(full.eligibleMinutes).toBeGreaterThan(last.eligibleMinutes);
    const arm = e.compareArms[0];
    expect(last.summary[arm].inputTokens).toBe(
      last.series.reduce((n, p) => n + p.arms[arm].inputTokens!, 0),
    );
    expect(last.summary[arm].cacheHit).toBeCloseTo(
      (last.summary[arm].cachedTokens! / last.summary[arm].inputTokens!) * 100,
    );
    const short = await fixtureApi.experiments.metrics(e.id, end - 59, end);
    expect(short.series).toHaveLength(0);
    expect(short.summary[arm].inputTPM).toBeNull();
    const norm = await fixtureApi.experiments.metrics(e.id, end - 600, end, {
      normalization: "per-gpu",
    });
    expect(norm.summary[arm].inputTokens).toBe(last.summary[arm].inputTokens);
    expect(norm.summary[arm].ttftP99).toBe(last.summary[arm].ttftP99);
    expect(full.range?.intersections).toHaveLength(2);
    expect(full.series.some((p) => p.error)).toBe(true);
  });
});
