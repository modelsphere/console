import type { Plan, PlanRequest } from "@swiss/lib/api";

export function requestFromPlan(request: PlanRequest, plan: Plan, overrides: Record<string, unknown>, catalog?: string): PlanRequest {
  return {
    ...request, fromRelease: undefined,
    catalog: plan.source.catalogName || catalog || request.catalog,
    model: plan.source.model, version: plan.source.version, variant: plan.source.variant,
    release: plan.release.name, namespace: plan.release.namespace,
    chartVersion: plan.chart.version, overrides,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export function samePlanBaseline(before: Plan, after: Plan, normalize: (layers: Plan["layers"]) => void): boolean {
  const snapshot = (plan: Plan) => {
    const layers = structuredClone(plan.layers ?? {});
    normalize(layers);
    return canonical({ release: plan.release, source: plan.source, chart: plan.chart, engine: plan.engine, profile: plan.profile, layers });
  };
  return snapshot(before) === snapshot(after);
}
