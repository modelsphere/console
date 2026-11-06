import type { Plan, PlanRequest } from "@swiss/lib/api";
import { requestFromPlan, samePlanBaseline } from "./plan-composition";
import { withRecovery, type RecoverySettings } from "./recovery";

type Tree = Record<string, unknown>;
const object = (value: unknown): Tree => value && typeof value === "object" && !Array.isArray(value) ? value as Tree : {};
const gatewayConfig = (form: Tree) => object(object(form.continuationGateway).config);
const clearTimeoutOverride = (layers: Plan["layers"]) => { delete gatewayConfig(layers.form ?? {}).stallIdleTimeoutSeconds; };

export class RecoveryPlanChangedError extends Error {}

export async function composeRecoveryPlan(request: PlanRequest, settings: RecoverySettings, compose: (request: PlanRequest) => Promise<Plan>, catalog?: string): Promise<Plan> {
  const prepared = withRecovery(request, settings);
  const proposed = await compose(prepared);
  if (!request.fromRelease || !settings.enabled || settings.idleTimeout.trim() || !Object.hasOwn(gatewayConfig(proposed.layers.form ?? {}), "stallIdleTimeoutSeconds")) return proposed;
  // fromRelease retains omitted map keys; recompose the validated form to remove this override.
  const overrides = structuredClone(proposed.layers.form);
  clearTimeoutOverride({ form: overrides });
  const cleaned = await compose(requestFromPlan(prepared, proposed, overrides, catalog));
  if (!samePlanBaseline(proposed, cleaned, clearTimeoutOverride) || Object.hasOwn(gatewayConfig(cleaned.layers.form ?? {}), "stallIdleTimeoutSeconds")) throw new RecoveryPlanChangedError();
  return cleaned;
}

// Preview the same pinned form that deployment uses, including removed upgrade overrides.
export async function composeRecoveryValuesRequest(request: PlanRequest, settings: RecoverySettings, compose: (request: PlanRequest) => Promise<Plan>, catalog?: string): Promise<PlanRequest> {
  const plan = await composeRecoveryPlan(request, settings, compose, catalog);
  return requestFromPlan(request, plan, plan.layers.form, catalog);
}
