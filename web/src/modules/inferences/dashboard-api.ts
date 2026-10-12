import { ApiError, request } from "@/shell";
import { api, type DeploymentsResponse } from "@swiss/lib/api";
import { apiPath } from "@swiss/lib/host";
import { HISTORY_LIMIT, HOUR_MS, recordedTimeline, type DeploymentTimeline } from "@/modules/inferences/dashboard-lib";

export async function readDeploymentTimeline(now = Date.now()): Promise<DeploymentTimeline> {
  const from = new Date(now - 24 * HOUR_MS).toISOString();
  const to = new Date(now).toISOString();
  const query = new URLSearchParams({ from, to });
  try {
    const data = await request<Omit<DeploymentTimeline, "complete">>("GET", apiPath(`/api/runs/timeline?${query}`));
    if (typeof data.hasStore !== "boolean" || !Array.isArray(data.buckets))
      throw new Error("Invalid deployment timeline response");
    return { ...data, complete: true };
  } catch (error) {
    const unsupported =
      error instanceof ApiError &&
      (error.status === 404 ||
        error.status === 405 ||
        (error.status === 400 && error.message === "run id must be a number") ||
        (error.status === 503 && error.message === "no database: this swissd keeps no operation log"));
    if (!unsupported) throw error;
    const data = await api.runs({ limit: HISTORY_LIMIT });
    return recordedTimeline(data.runs, from, to, data.hasStore);
  }
}

// swissd caps a page at 100; health counts must cover every service, so keep
// paging until the server total is reached.
const PAGE = 100;
export async function allDeployments(): Promise<DeploymentsResponse> {
  const first = await api.deployments(1, PAGE);
  const pages = Math.ceil(first.summary.total / PAGE);
  if (pages <= 1) return first;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.deployments(i + 2, PAGE)));
  return { ...first, deployments: [...first.deployments, ...rest.flatMap((r) => r.deployments)] };
}
