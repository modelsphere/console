import type { Experiment, Metrics } from "../types";

export const finiteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
export function format(value: number | null | undefined, digits = 3) {
  if (!finiteNumber(value)) return "—";
  if (value !== 0 && Math.abs(value) < 10 ** -digits)
    return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
export function difference(
  control: number | null | undefined,
  experiment: number | null | undefined,
) {
  if (!finiteNumber(control) || !finiteNumber(experiment))
    return { absolute: null, relative: null };
  return {
    absolute: experiment - control,
    relative: control === 0 ? null : ((experiment - control) / control) * 100,
  };
}
export function tpsPreview(data: Metrics, arm: string, threshold: number) {
  const values = data.series
    .filter((p) => !p.error)
    .map((p) => p.arms[arm]?.overallTPS)
    .filter(finiteNumber);
  const failed = values.filter((v) => v < threshold).length;
  return {
    values,
    failed,
    evaluated: values.length,
    pass: values.length
      ? (100 * (values.length - failed)) / values.length
      : null,
  };
}
export const timeRanges = [
  [0, "Full"],
  [60, "1m"],
  [600, "10m"],
  [1800, "30m"],
  [3600, "1h"],
  [7200, "2h"],
  [14400, "4h"],
  [28800, "8h"],
  [43200, "12h"],
  [86400, "1d"],
  [259200, "3d"],
] as const;
export function rangeBounds(
  experiment: Pick<Experiment, "stopAt">,
  seconds: number,
  now = Date.now(),
) {
  const end = Math.floor(
    (experiment.stopAt ? Date.parse(experiment.stopAt) : now) / 1000,
  );
  return { start: seconds > 0 ? end - seconds : undefined, end };
}
export function readPreference<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function savePreference(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be disabled by the host. */
  }
}
