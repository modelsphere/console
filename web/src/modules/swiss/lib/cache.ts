import type { SiteProfile, Variant } from "@swiss/lib/api";
import { featureUnsupported, type FeatureUnsupported } from "@swiss/lib/features";

// What an empty field leaves in force.
export interface CacheDefaults {
  hostPath: string;
  historyLimit: number;
  maxSlotsPerNode: number;
}

// The sglang chart's own values.
const CHART: CacheDefaults = { hostPath: "/mnt/disk0/sglang-cache", historyLimit: 2, maxSlotsPerNode: 8 };

// Mirrors compose: the site layer sits above the catalog's, and swissd derives
// the slots from the node size only when the site turns the cache on and the
// variant does not set them.
export function cacheDefaults(site: SiteProfile | undefined, variant: Pick<Variant, "values" | "requires"> | undefined): CacheDefaults {
  const own = (variant?.values?.cache ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const siteOn = !!site?.cache?.enabled;
  const perNode = site?.nodes?.gpusPerNode ?? 0;
  const gpus = variant?.requires.gpus ?? 0;
  const derived = siteOn && perNode > 0 && gpus > 0 ? Math.max(Math.floor(perNode / gpus), 1) : undefined;
  return {
    hostPath: (siteOn && site?.cache?.hostPath) || (typeof own.hostPath === "string" && own.hostPath) || CHART.hostPath,
    historyLimit: n(own.historyLimit) ?? CHART.historyLimit,
    maxSlotsPerNode: n(own.maxSlotsPerNode) ?? derived ?? CHART.maxSlotsPerNode,
  };
}

// The deploy form's cache card: greyed out, with why, when the chart cannot
// take it. siteOn is a site that turns the cache on for every deploy: its
// values still reach the plan for such a chart, which then needs
// skipSchemaValidation.
export interface CacheCard {
  defaults: CacheDefaults;
  siteOn: boolean;
  unsupported?: FeatureUnsupported;
}

export function cacheCard(
  site: SiteProfile | undefined,
  variant: Pick<Variant, "values" | "requires"> | undefined,
  chart: { name?: string; version?: string },
): CacheCard {
  return {
    defaults: cacheDefaults(site, variant),
    siteOn: !!site?.cache?.enabled,
    unsupported: featureUnsupported("cache", chart.name, chart.version),
  };
}

// The chart's schema bounds: at least 1 template kept, 1 to 64 slots.
export function cacheFieldError(key: "historyLimit" | "maxSlotsPerNode", raw: string): boolean {
  if (!raw.trim()) return false;
  const v = Number(raw);
  return v < 1 || (key === "maxSlotsPerNode" && v > 64);
}
