import type { Json, JsonObject, LayerDocuments, LayerName } from "../types";
import { LAYER_ORDER } from "../types";

export const OPERATOR_OWNED_ENABLED = [
  ["scaler", "enabled"],
  ["cart", "enabled"],
  ["sloRequirement", "enabled"],
] as const;

export function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

export function isObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Last-writer-wins deep merge. Arrays are replaced, not concatenated. */
export function mergeObjects(
  base: JsonObject,
  overlay: JsonObject,
): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (isObject(prev) && isObject(value)) {
      out[key] = mergeObjects(prev, value);
    } else {
      out[key] = cloneJson(value);
    }
  }
  return out;
}

export function mergeLayers(
  layers: LayerDocuments,
  order: readonly LayerName[] = LAYER_ORDER,
): JsonObject {
  let out: JsonObject = {};
  for (const name of order) {
    const doc = layers[name];
    if (doc) out = mergeObjects(out, doc);
  }
  return out;
}

function deletePath(obj: JsonObject, path: readonly string[]): boolean {
  if (path.length === 0) return false;
  const [head, ...rest] = path;
  if (!(head in obj)) return false;
  if (rest.length === 0) {
    delete obj[head];
    return true;
  }
  const child = obj[head];
  if (!isObject(child)) return false;
  const removed = deletePath(child, rest);
  if (removed && Object.keys(child).length === 0) delete obj[head];
  return removed;
}

function hasPath(obj: JsonObject, path: readonly string[]): boolean {
  let cur: Json = obj;
  for (const key of path) {
    if (!isObject(cur) || !(key in cur)) return false;
    cur = cur[key];
  }
  return true;
}

/**
 * Drop operator-owned `*.enabled` switches from arm values before they go on
 * the LLMCanary CR. The operator refuses `scaler.enabled`, `cart.enabled` and
 * `sloRequirement.enabled` today; the original layers remain in the stored plan.
 */
export function stripOperatorOwned(values: JsonObject): {
  stripped: JsonObject;
  removed: string[];
} {
  const stripped = cloneJson(values);
  const removed: string[] = [];
  for (const path of OPERATOR_OWNED_ENABLED) {
    if (hasPath(stripped, path)) {
      deletePath(stripped, path);
      removed.push(path.join("."));
    }
  }
  return { stripped, removed };
}

export function isExactChartVersion(version: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version) &&
    !/[<>=^~|*xX]/.test(version)
  );
}

export function dnsLabel(value: string): boolean {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

export function armNameOk(value: string): boolean {
  return value.length >= 1 && value.length <= 20 && dnsLabel(value);
}

export function trafficShare(
  production: number,
  canary: number,
): { production: number; canary: number } {
  const sum = production + canary;
  if (sum <= 0) return { production: 0, canary: 0 };
  return { production: production / sum, canary: canary / sum };
}
