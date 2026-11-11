import type { Deployment } from "@swiss/lib/api";
import { isVideoDeployment } from "@swiss/lib/video";

// RouteModels is one gateway route as console's /api/llm/routes reports it: the
// models it lists, or why it listed none.
export interface RouteModels {
  route: string;
  models?: string[] | null;
  error?: string;
}

// A Target is one deployment as the Playground offers it. id is the route, which
// is what tells two deployments of the same served name apart; model is the name
// the engine answers to, what goes in the request body.
export interface Target {
  id: string;
  model: string;
  release: string;
  namespace: string;
  // Catalog model, version and variant, as the deployment pages show them.
  catalogModel?: string;
  version?: string;
  variant?: string;
  ready: boolean;
  reason?: NotReady;
}

// Why a deployment cannot be talked to yet.
export type NotReady =
  // Deployed without a gateway route (modelRoute off): nothing to send a turn to.
  | { kind: "noRoute" }
  // The route is not in the gateway's route ConfigMap yet.
  | { kind: "notPublished"; route: string }
  // The route is published but its engines did not list a model: not ready.
  | { kind: "notServing"; route: string; error?: string };

// joinTargets lists the deployments the deployment pages list, each with what
// the gateway says about its route. Routes no deployment owns are left out: the
// Playground tries what was deployed here, nothing else. Ready ones come first.
// A video release has no chat to try, so it is not offered.
export function joinTargets(deployments: Deployment[], routes: RouteModels[]): Target[] {
  const byRoute = new Map(routes.map((r) => [r.route, r]));
  const out = deployments.filter((d) => !isVideoDeployment(d)).map((d): Target => {
    const base = {
      release: d.release,
      namespace: d.namespace,
      catalogModel: d.model,
      version: d.version,
      variant: d.variant,
    };
    if (!d.route) return { ...base, id: `${d.namespace}/${d.release}`, model: "", ready: false, reason: { kind: "noRoute" } };
    const r = byRoute.get(d.route);
    if (!r) return { ...base, id: d.route, model: "", ready: false, reason: { kind: "notPublished", route: d.route } };
    const served = r.models?.[0];
    if (r.error || !served) return { ...base, id: d.route, model: "", ready: false, reason: { kind: "notServing", route: d.route, error: r.error } };
    return { ...base, id: d.route, model: served, ready: true };
  });
  return out.sort((a, b) => Number(b.ready) - Number(a.ready));
}
