import type { Form } from "@swiss/components/DeploySettings";
import { composeAdaptivePlan, AdaptivePlanChangedError } from "./adaptive-concurrency";
import { composeRecoveryPlan, RecoveryPlanChangedError } from "./recovery-compose";
import type { RecoverySettings } from "./recovery";
import type { RouteOptions } from "./routeOptions";
import { api, type Plan, type PlanRequest, type RevisionValues } from "@swiss/lib/api";
import { mergeValues, parseValues, valuesYaml, type Values } from "./override-yaml";

export class DeploymentChangedError extends Error {
  constructor() { super("The deployment changed. Reload its current revision and preview again."); }
}

export async function assertDeploymentRevision(namespace: string, release: string, revision: number): Promise<void> {
  const current = await api.status(namespace, release);
  if (!current.exists || current.revision !== revision) throw new DeploymentChangedError();
}

export async function readDeploymentRevision(namespace: string, release: string): Promise<RevisionValues> {
  const current = await api.status(namespace, release);
  if (!current.exists || !Number.isInteger(current.revision) || current.revision <= 0) throw new DeploymentChangedError();
  const snapshot = await api.revisionValues(namespace, release, current.revision);
  if (snapshot.namespace !== namespace || snapshot.release !== release || snapshot.revision !== current.revision) throw new DeploymentChangedError();
  parseValues(snapshot.all);
  await assertDeploymentRevision(namespace, release, current.revision);
  return snapshot;
}


export function deploymentPolicy(request: PlanRequest): Values {
  const route = request.overrides?.modelRoute as Values | undefined;
  const monitor = route?.monitor as Values | undefined;
  return typeof monitor?.enabled === "boolean" ? { modelRoute: { monitor: { enabled: monitor.enabled } } } : {};
}

export interface DeploymentSettings {
  form: Form;
  recovery: RecoverySettings;
  routeOptions?: RouteOptions | null;
}

export async function composeDeploymentDraft(request: PlanRequest, values: Values, compose: (request: PlanRequest) => Promise<Plan>, catalog?: string, settings?: DeploymentSettings): Promise<Plan> {
  const identity = request.serviceId || request.release || request.fromRelease || request.model;
  if (Object.hasOwn(values, "serviceId") && values.serviceId !== identity) throw new Error(`serviceId must match the deployment identity (${identity}).`);
  const prepared = { ...request, catalog: request.catalog || catalog, editsYAML: valuesYaml(mergeValues(values, deploymentPolicy(request))) };
  if (!settings) return compose(prepared);
  try {
    return await composeRecoveryPlan(prepared, settings.recovery, (input) => composeAdaptivePlan(input, settings.form, settings.routeOptions, compose, catalog), catalog);
  } catch (error) {
    if (error instanceof RecoveryPlanChangedError || error instanceof AdaptivePlanChangedError) throw new DeploymentChangedError();
    throw error;
  }
}

export function deploymentValuesRequest(request: PlanRequest, plan: Plan, catalog?: string): PlanRequest {
  return {
    ...request,
    catalog: plan.source.catalogName || catalog || request.catalog,
    model: plan.source.model, version: plan.source.version, variant: plan.source.variant,
    chartVersion: plan.chart.version, release: plan.release.name, namespace: plan.release.namespace,
    overrides: plan.layers.form ?? {}, editsYAML: valuesYaml(plan.layers.edit ?? {}),
  };
}
