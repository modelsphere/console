import type { MetricSummary, TokenPrices } from "../types";
import { finiteNumber } from "./metric-presentation";
export type QuoteMode = "fixed" | "lower" | "upper";
export function quotedRevenue(
  summary: MetricSummary | undefined,
  prices: TokenPrices | null | undefined,
  hit: number,
  mode: QuoteMode,
) {
  if (
    !summary ||
    !prices ||
    !finiteNumber(hit) ||
    hit < 0 ||
    hit > 100 ||
    Object.values(prices).some((p) => !finiteNumber(p) || p < 0 || p > 1e6)
  )
    return null;
  if (!finiteNumber(summary.inputTPM) || !finiteNumber(summary.outputTPM))
    return null;
  const actual = summary.cacheHit;
  if (mode !== "fixed" && !finiteNumber(actual)) return null;
  const applied =
    mode === "fixed"
      ? hit
      : mode === "lower"
        ? Math.max(actual!, hit)
        : Math.min(actual!, hit);
  const cached = (summary.inputTPM * applied) / 100;
  const input = ((summary.inputTPM - cached) * prices.inputPerMillion) / 1e6;
  const cache = (cached * prices.cachedPerMillion) / 1e6;
  const output = (summary.outputTPM * prices.outputPerMillion) / 1e6;
  return {
    applied,
    input,
    cached: cache,
    output,
    minute: input + cache + output,
    hour: (input + cache + output) * 60,
  };
}
