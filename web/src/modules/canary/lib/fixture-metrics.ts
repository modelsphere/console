import type {
  Experiment,
  MetricSummary,
  Metrics,
  ValuationView,
} from "../types";
import { fixtureValue } from "./fixture-economics";

export const emptyMetrics: MetricSummary = {
  inputTokens: null,
  cachedTokens: null,
  outputTokens: null,
  ttftMean: null,
  ttftP50: null,
  ttftP99: null,
  ttftP999: null,
  uncachedTPM: null,
  revenueInputPerMinute: null,
  revenueCachedPerMinute: null,
  revenueOutputPerMinute: null,
  revenuePerMinute: null,
  revenuePerHour: null,
  cacheHit: null,
  inputTPM: null,
  cachedTPM: null,
  outputTPM: null,
  totalTPM: null,
  ttftP95: null,
  overallTPS: null,
  decodeTPS: null,
  requests: null,
  ttftSamples: null,
  completeMinutes: 0,
};
export function fixtureMetrics(
  e: Experiment,
  start = 0,
  end = Math.floor(Date.now() / 1000),
  view: ValuationView,
): Metrics {
  const points: Metrics["series"] = [];
  const intersections: [number, number][] = [];
  let eligible = 0;
  for (const [wi, w] of e.windows.entries()) {
    const lo = Math.max(start, Date.parse(w.start) / 1000),
      hi = Math.min(end, Date.parse(w.end) / 1000);
    if (hi > lo) intersections.push([lo, hi]);
    for (
      let at = Math.ceil((Date.parse(w.start) / 1000 + 60) / 60) * 60;
      at <= hi;
      at += 60
    ) {
      if (at - 60 < start) continue;
      eligible++;
      const i = Math.round((at - Date.parse(w.start) / 1000) / 60);
      const error =
        wi === 0 && i === 8 ? "Synthetic exporter replacement gap" : undefined;
      const arms = Object.fromEntries(
        e.compareArms.map((arm, a) => {
          if (i <= 2 || error) return [arm, { ...emptyMetrics }];
          const input = 80000 + i * 1800 + a * 16000,
            cached = input * (0.2 + (i % 5) * 0.1 + a * 0.05),
            output = 10000 + i * 200 + a * 4000;
          const top = 0.4 + a * 0.1;
          return [
            arm,
            {
              ...emptyMetrics,
              inputTokens: input,
              cachedTokens: cached,
              outputTokens: output,
              inputTPM: input,
              cachedTPM: cached,
              outputTPM: output,
              totalTPM: input + output,
              cacheHit: (cached / input) * 100,
              ttftMean: top / 2,
              ttftP50: top * 0.5,
              ttftP95: top * 0.95,
              ttftP99: top * 0.99,
              ttftP999: top * 0.999,
              overallTPS: i % 6 === 0 ? 0 : 25 + i * 2 + a * 12,
              decodeTPS: 50 + i + a * 10,
              requests: 30 + i,
              ttftSamples: 30 + i,
              completeMinutes: 1,
            },
          ];
        }),
      );
      points.push({ time: at, arms, ...(error ? { error } : {}) });
    }
  }
  const summary = Object.fromEntries(
    e.compareArms.map((arm) => {
      const valid = points
        .filter((p) => !p.error && p.arms[arm].inputTokens != null)
        .map((p) => p.arms[arm]);
      if (!valid.length) return [arm, { ...emptyMetrics }];
      const sum = (key: keyof MetricSummary) =>
        valid.reduce((n, p) => n + (p[key] ?? 0), 0);
      const input = sum("inputTokens"),
        cached = sum("cachedTokens"),
        output = sum("outputTokens"),
        samples = sum("ttftSamples");
      return [
        arm,
        fixtureValue(
          {
            ...valid[0],
            inputTokens: input,
            cachedTokens: cached,
            outputTokens: output,
            inputTPM: input / valid.length,
            cachedTPM: cached / valid.length,
            outputTPM: output / valid.length,
            totalTPM: (input + output) / valid.length,
            cacheHit: (cached / input) * 100,
            requests: sum("requests"),
            ttftSamples: samples,
            overallTPS:
              valid.reduce((n, p) => n + p.overallTPS! * p.ttftSamples!, 0) /
              samples,
            decodeTPS:
              valid.reduce((n, p) => n + p.decodeTPS! * p.ttftSamples!, 0) /
              samples,
            completeMinutes: valid.length,
          },
          e.prepared.economics,
          arm,
          view,
        ),
      ];
    }),
  );
  const stored = points.filter(
    (p) => !p.error && e.compareArms.some((a) => p.arms[a].inputTokens != null),
  );
  return {
    experimentId: e.id,
    compareArms: e.compareArms,
    windows: e.windows,
    resolutionSeconds: 60,
    economics: e.prepared.economics,
    valuation: view,
    eligibleMinutes: eligible,
    excludedMinutes: points.filter((p) => p.error).length,
    lastCollectedAt: stored.length
      ? new Date(stored.at(-1)!.time * 1000 + 30000).toISOString()
      : null,
    range: {
      start,
      end,
      intersections,
      dataStart: stored.length ? stored[0].time - 60 : null,
      dataEnd: stored.at(-1)?.time ?? null,
    },
    summary,
    series: points.map((p) => ({
      ...p,
      arms: Object.fromEntries(
        e.compareArms.map((a) => [
          a,
          fixtureValue(p.arms[a], e.prepared.economics, a, view),
        ]),
      ),
    })),
    delta: Object.fromEntries(
      Object.keys(emptyMetrics).map((key) => {
        const k = key as keyof MetricSummary,
          a = summary[e.compareArms[0]][k],
          b = summary[e.compareArms[1]][k];
        return [key, a == null || b == null ? null : b - a];
      }),
    ) as unknown as MetricSummary,
    snapshot: e.snapshot,
  };
}
