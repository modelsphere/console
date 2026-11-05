import { parseDocument, stringify } from "yaml";
import { layersOf } from "@swiss/components/Provenance";
import type { Plan, PlanRequest } from "@swiss/lib/api";

type Values = Record<string, unknown>;
const isMap = (value: unknown): value is Values => !!value && typeof value === "object" && !Array.isArray(value);

// Helm merges maps recursively; lists and scalar values replace the previous layer.
function mergeValues(previous: Values, next: Values, removeNulls = false): Values {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(next)])].flatMap((key) => {
    if (!Object.hasOwn(next, key)) return [[key, previous[key]]];
    if (removeNulls && next[key] === null) return [];
    const value = isMap(next[key]) ? mergeValues(isMap(previous[key]) ? previous[key] : {}, next[key], removeNulls) : next[key];
    return [[key, value]];
  }));
}

export function deploymentValues(plan: Plan): Values {
  return layersOf(plan).reduce((values, layer) => mergeValues(values, plan.layers[layer], true), {});
}

export function deploymentYaml(plan: Plan): string {
  return stringify(deploymentValues(plan));
}

export function parseDeploymentYaml(text: string): Values {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors[0].message);
  if (document.warnings.length) throw new Error(document.warnings[0].message);
  const values: unknown = document.toJS({ maxAliasCount: 100 });
  JSON.stringify(values, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("YAML values must contain finite numbers.");
    if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("YAML values must contain plain mappings, lists and scalars.");
    return value;
  });
  if (!isMap(values)) throw new Error("YAML must contain a mapping of deployment values.");
  return values;
}

function sameValue(previous: unknown, next: unknown): boolean {
  if (isMap(previous) && isMap(next)) return Object.keys(previous).length === Object.keys(next).length
    && Object.keys(previous).every((key) => Object.hasOwn(next, key) && sameValue(previous[key], next[key]));
  if (Array.isArray(previous) && Array.isArray(next)) return previous.length === next.length && previous.every((value, index) => sameValue(value, next[index]));
  return Object.is(previous, next);
}

// Only changed values enter the edit layer, so viewing YAML never pins inherited defaults.
function changedValues(previous: Values, next: Values): Values {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(next)])].flatMap((key) => {
    if (!Object.hasOwn(next, key)) return [[key, null]];
    if (sameValue(previous[key], next[key])) return [];
    const value = isMap(previous[key]) && isMap(next[key]) ? changedValues(previous[key], next[key]) : next[key];
    return [[key, value]];
  }));
}

export function yamlPlanRequest(request: PlanRequest, plan: Plan, text: string): PlanRequest {
  const changes = changedValues(deploymentValues(plan), parseDeploymentYaml(text));
  const edits = mergeValues(plan.layers.edit ?? {}, changes);
  return {
    ...request,
    catalog: plan.source.catalogName || request.catalog,
    model: plan.source.model,
    version: plan.source.version,
    variant: plan.source.variant,
    chartVersion: plan.chart.version,
    release: plan.release.name,
    namespace: plan.release.namespace,
    overrides: plan.layers.form ?? {},
    editsYAML: Object.keys(edits).length ? stringify(edits) : undefined,
  };
}

export function matchesDeploymentYaml(plan: Plan, text: string): boolean {
  return sameValue(deploymentValues(plan), mergeValues({}, parseDeploymentYaml(text), true));
}
