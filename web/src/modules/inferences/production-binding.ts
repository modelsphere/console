import type { Plan } from "@swiss/lib/api";
import { layersOf } from "@swiss/components/Provenance";

type Tree = Record<string, unknown>;
const object = (value: unknown): Tree => value && typeof value === "object" && !Array.isArray(value) ? value as Tree : {};

function merge(target: Tree, source: Tree): Tree {
  for (const [key, value] of Object.entries(source)) {
    if (value === null) delete target[key];
    else if (value && typeof value === "object" && !Array.isArray(value)) target[key] = merge({ ...object(target[key]) }, object(value));
    else target[key] = value;
  }
  return target;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function binding(plan: Plan): string {
  const values = layersOf(plan).reduce((tree, layer) => merge(tree, plan.layers[layer]), {} as Tree);
  const route = object(values.modelRoute);
  const nginx = object(route.nginx);
  return canonical({
    release: plan.release, chart: plan.chart,
    serviceId: values.serviceId, nameOverride: values.nameOverride, fullnameOverride: values.fullnameOverride,
    service: values.service,
    route: { enabled: route.enabled, name: route.name, discovery: route.discovery, service: nginx.service, path: nginx.route },
  });
}

export class ProductionBindingChangedError extends Error {}

export function assertProductionBinding(current: Plan, proposed: Plan): void {
  if (binding(current) !== binding(proposed)) throw new ProductionBindingChangedError();
}
