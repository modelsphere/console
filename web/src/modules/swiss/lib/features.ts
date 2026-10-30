import { isChartRange } from "@swiss/lib/upgrade";

// CHART_FEATURES is the first release of each chart with an optional values
// section, by feature. Empty or absent is a chart without it yet. A chart's
// values schema refuses a section it does not know, so the deploy form writes
// none for such a chart. swissd composes whatever it is sent: a site that turns
// a section on still puts it in the plan, and only skipSchemaValidation
// deploys that.
export const CHART_FEATURES: Record<string, Record<string, string>> = {
  cache: { sglang: "0.9.1", vllm: "" },
};

// Why a chart cannot take a feature: it has none, or since is the first release
// that does.
export interface FeatureUnsupported {
  chart: string;
  since?: string;
}

// version is the chart version the plan resolves to; unknown yet, or a range,
// is the newest release.
export function featureUnsupported(feature: string, name: string | undefined, version: string | undefined): FeatureUnsupported | undefined {
  const since = name ? CHART_FEATURES[feature]?.[name] : undefined;
  if (!since) return { chart: name ?? "" };
  if (!version || isChartRange(version) || !older(version, since)) return undefined;
  return { chart: name!, since };
}

function older(version: string, than: string): boolean {
  const v = version.split(/[.+-]/, 3).map(Number);
  const t = than.split(".").map(Number);
  for (let i = 0; i < t.length; i++) if (v[i] !== t[i]) return v[i] < t[i];
  return false;
}
