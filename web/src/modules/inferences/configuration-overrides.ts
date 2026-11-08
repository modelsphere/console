import type { Plan } from "@swiss/lib/api";
import { layersOf } from "@swiss/components/Provenance";
import type { Values } from "./override-yaml";

export interface ConfigurationOverride {
  path: string;
  requested: unknown;
  actual: unknown;
  source: string;
}

function leaves(values: Values, prefix: string[] = []): { path: string[]; value: unknown }[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const path = [...prefix, key];
    return value && typeof value === "object" && !Array.isArray(value) ? leaves(value as Values, path) : [{ path, value }];
  });
}

function at(values: Values, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => current && typeof current === "object" && Object.hasOwn(current, key) ? (current as Values)[key] : undefined, values);
}

function writesPath(values: Values, path: string[]): boolean {
  let current: unknown = values;
  for (const key of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return false;
    current = (current as Values)[key];
    if (current === null || typeof current !== "object" || Array.isArray(current)) return true;
  }
  return true;
}

export function configurationOverrides(plan: Plan, requested: Values, effective: Values, policy: Values = {}): ConfigurationOverride[] {
  const ordered = layersOf(plan);
  const system = ordered.slice(Math.max(ordered.indexOf("form"), ordered.indexOf("edit")) + 1).reverse();
  return leaves(requested).flatMap(({ path, value }) => {
    const actual = at(effective, path);
    if ((value === null && actual === undefined) || JSON.stringify(value) === JSON.stringify(actual)) return [];
    const source = system.find((key) => writesPath(plan.layers[key], path)) ?? (writesPath(policy, path) ? "site" : undefined);
    return source ? [{ path: path.join("."), requested: value, actual, source }] : [];
  });
}
