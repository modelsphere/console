import { api, type DeploymentsResponse } from "@swiss/lib/api";
import { HISTORY_LIMIT, HOUR_MS, recordedTimeline, type DeploymentTimeline } from "@/modules/inferences/dashboard-lib";

export async function readDeploymentTimeline(now = Date.now()): Promise<DeploymentTimeline> {
  const from = new Date(now - 24 * HOUR_MS).toISOString();
  const to = new Date(now).toISOString();
  const data = await api.runs({ limit: HISTORY_LIMIT });
  if (typeof data.hasStore !== "boolean" || !Array.isArray(data.runs)) {
    throw new Error("Invalid deployment history response");
  }
  return recordedTimeline(data.runs, from, to, data.hasStore);
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
