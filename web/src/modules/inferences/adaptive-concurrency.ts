import type { Form } from "@swiss/components/DeploySettings";
import type { Plan, PlanRequest } from "@swiss/lib/api";
import { routeDirectives, type RouteOptions } from "./routeOptions";

type Tree = Record<string, unknown>;
const object = (value: unknown): Tree => value && typeof value === "object" && !Array.isArray(value) ? value as Tree : {};
const routeValues = (tree: Tree) => object(object(object(tree.modelRoute).nginx).values);

export function isAdaptiveOption(key: string, options?: RouteOptions | null): boolean {
  return routeDirectives(options).find((directive) => directive.key === key)?.needsAdaptive ?? key.startsWith("adaptive_cc_");
}

export function toggleAdaptive(form: Form, enabled: boolean, options?: RouteOptions | null): Partial<Form> {
  return { adaptiveCc: enabled, adaptiveCcMinFrac: "", nginxExtras: form.nginxExtras.filter((row) => !isAdaptiveOption(row.key, options)) };
}

export function needsAdaptiveCleanup(plan: Plan, options?: RouteOptions | null): boolean {
  return Object.keys(routeValues(plan.layers?.form ?? {})).some((key) => isAdaptiveOption(key, options));
}

export function withAdaptiveConcurrency(request: PlanRequest, form: Form, options?: RouteOptions | null, composed?: Plan, catalog?: string): PlanRequest {
  if (form.adaptiveCc) return request;
  const overrides: Tree = structuredClone(composed?.layers?.form ?? request.overrides ?? {});
  const modelRoute = object(overrides.modelRoute);
  const nginx = object(modelRoute.nginx);
  const values = object(nginx.values);
  for (const key of Object.keys(values)) if (isAdaptiveOption(key, options)) delete values[key];
  values.adaptive_cc = "false";
  nginx.values = values;
  modelRoute.nginx = nginx;
  overrides.modelRoute = modelRoute;
  if (!composed) return { ...request, overrides };
  return {
    ...request, fromRelease: undefined,
    catalog: composed.source.catalogName || catalog || request.catalog,
    model: composed.source.model, version: composed.source.version,
    variant: composed.source.variant,
    release: composed.release.name, namespace: composed.release.namespace,
    chartVersion: composed.chart.version, overrides,
  };
}

export class AdaptivePlanChangedError extends Error {}

export async function composeAdaptivePlan(request: PlanRequest, form: Form, options: RouteOptions | null | undefined, compose: (request: PlanRequest) => Promise<Plan>, catalog?: string): Promise<Plan> {
  const prepared = withAdaptiveConcurrency(request, form, options);
  const proposed = await compose(prepared);
  if (request.fromRelease && !form.adaptiveCc && needsAdaptiveCleanup(proposed, options)) {
    const cleaned = await compose(withAdaptiveConcurrency(prepared, form, options, proposed, catalog));
    if (!sameAdaptiveBaseline(proposed, cleaned, options) || needsAdaptiveCleanup(cleaned, options)) throw new AdaptivePlanChangedError();
    return cleaned;
  }
  return proposed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export function sameAdaptiveBaseline(before: Plan, after: Plan, options?: RouteOptions | null): boolean {
  const layers = (plan: Plan) => {
    const copy = structuredClone(plan.layers ?? {});
    const values = routeValues(copy.form ?? {});
    for (const key of Object.keys(values)) if (key === "adaptive_cc" || isAdaptiveOption(key, options)) delete values[key];
    const form = object(copy.form);
    const route = object(form.modelRoute);
    const nginx = object(route.nginx);
    if (!Object.keys(values).length) delete nginx.values;
    if (!Object.keys(nginx).length) delete route.nginx;
    if (!Object.keys(route).length) delete form.modelRoute;
    if (!Object.keys(form).length) delete copy.form;
    return canonical(copy);
  };
  return before.release.name === after.release.name && before.release.namespace === after.release.namespace
    && before.chart.name === after.chart.name && before.chart.version === after.chart.version && before.chart.repo === after.chart.repo && before.chart.path === after.chart.path
    && before.engine === after.engine && before.profile === after.profile && layers(before) === layers(after)
    && (["catalog", "catalogName", "model", "variant", "version", "hf", "digest"] as const).every((key) => before.source[key] === after.source[key]);
}


export async function composeReferencedPlan(live: Plan, form: Form, options: RouteOptions | null | undefined, compose: (request: PlanRequest) => Promise<Plan>): Promise<Plan> {
 const previous = routeValues(live.layers?.form ?? {});
 const values: Tree = {};
 for (const key of Object.keys(previous)) if (key === "adaptive_cc" || isAdaptiveOption(key, options)) values[key] = null;
 values.adaptive_cc = String(form.adaptiveCc);
 if (form.adaptiveCc) {
  if (form.adaptiveCcMinFrac.trim()) values.adaptive_cc_min_frac = form.adaptiveCcMinFrac.trim();
  for (const row of form.nginxExtras) if (isAdaptiveOption(row.key, options) && row.value.trim()) values[row.key] = row.value.trim();
 }
 const proposed = await compose({ reuseSource: true, fromRelease: live.release.name, namespace: live.release.namespace, overrides: { modelRoute: { nginx: { values } } } });
 if (!sameAdaptiveBaseline(live, proposed, options)) throw new AdaptivePlanChangedError();
 return proposed;
}
