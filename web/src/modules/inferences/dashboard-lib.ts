import type { CatalogResponse, Deployment, ReleaseStatus, Run } from "@swiss/lib/api";
import { releaseState, rowState, type State } from "@/modules/inferences/lib";

export const HOUR_MS = 3_600_000;
export const HISTORY_LIMIT = 500;

export interface DeploymentBucket {
  at: string;
  started: number;
  updated: number;
  failed: number;
}

export interface DeploymentTimeline {
  hasStore: boolean;
  from: string;
  to: string;
  buckets: DeploymentBucket[];
  complete: boolean;
}

export function supportedTotals(catalogs: CatalogResponse[]): { models: number; recipes: number } {
  const models = new Set<string>();
  const recipes = new Set<string>();
  for (const catalog of catalogs) {
    for (const model of catalog.index.models) {
      if (model.deprecated) continue;
      const identity = [model.name, model.source.hf, model.source.revision ?? ""];
      models.add(JSON.stringify(identity));
      for (const version of model.versions) {
        for (const variant of version.variants) {
          recipes.add(JSON.stringify([...identity, version.version, version.digest, variant.id]));
        }
      }
    }
  }
  return { models: models.size, recipes: recipes.size };
}

export function recordedTimeline(runs: Run[], from: string, to: string, hasStore: boolean): DeploymentTimeline {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Invalid timeline range");
  const complete = runs.length < HISTORY_LIMIT;
  const result: DeploymentTimeline = { hasStore, from, to, complete, buckets: [] };
  if (!hasStore || !complete) return result;

  const first = Math.floor(start / HOUR_MS) * HOUR_MS;
  for (let hour = first; hour < end; hour += HOUR_MS) {
    result.buckets.push({ at: new Date(hour).toISOString(), started: 0, updated: 0, failed: 0 });
  }
  for (const run of runs) {
    if (!["install", "apply", "rollback"].includes(run.action)) continue;
    const at = Date.parse(run.startedAt);
    if (!Number.isFinite(at)) throw new Error("Invalid deployment timestamp");
    if (at < start || at >= end) continue;
    const bucket = result.buckets[Math.floor((at - first) / HOUR_MS)];
    if (run.error) bucket.failed++;
    else if (run.changed && run.action === "install") bucket.started++;
    else if (run.changed) bucket.updated++;
  }
  return result;
}

export function timelineTotals(timeline: DeploymentTimeline) {
  if (!timeline.hasStore || !timeline.complete) return null;
  return timeline.buckets.reduce(
    (sum, bucket) => ({
      started: sum.started + bucket.started,
      updated: sum.updated + bucket.updated,
      failed: sum.failed + bucket.failed,
    }),
    { started: 0, updated: 0, failed: 0 },
  );
}

export type HealthBucket = "serving" | "failed" | "degraded" | "unknown";
export interface ServiceHealth {
  serving: number;
  failed: number;
  degraded: number;
  ready: number;
  instances: number;
  unknown: number;
}
type StatusSlot = { data?: ReleaseStatus; error?: unknown };

// The state a dashboard row shows: live status when it loaded, the list row
// otherwise, and unknown when the read itself failed.
export function currentState(d: Deployment, s?: StatusSlot): State {
  if (s?.error) return { key: "unknown", tone: "muted" };
  return s?.data ? releaseState(s.data) : rowState(d);
}

export function healthBucket(state: State): HealthBucket {
  if (state.tone === "error") return "failed";
  if (state.key === "serving") return "serving";
  if (state.key === "loading" || state.key === "applying" || state.key === "noPods" || state.key === "uninstalling") return "degraded";
  return "unknown";
}

// Troubled first, so the preview surfaces what needs an operator.
export function healthRank(d: Deployment, s?: StatusSlot): number {
  const bucket = healthBucket(currentState(d, s));
  return bucket === "failed" ? 0 : bucket === "degraded" ? 1 : bucket === "serving" ? 2 : 3;
}

// Health counts assume every row's status read has settled (data or error):
// an unsettled read is unknown, never silently healthy or failed.
export function serviceHealth(rows: readonly Deployment[], statuses: readonly (StatusSlot | undefined)[]): ServiceHealth {
  const out: ServiceHealth = { serving: 0, failed: 0, degraded: 0, ready: 0, instances: 0, unknown: 0 };
  rows.forEach((_, i) => {
    const s = statuses[i];
    if (!s?.error && !s?.data) {
      out.unknown++;
      return;
    }
    out[healthBucket(currentState(rows[i], s))]++;
    if (s.data) {
      out.ready += s.data.ready;
      out.instances += s.data.total;
    }
  });
  return out;
}
