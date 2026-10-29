import type { JsonObject, LayerDocuments, LayerName } from "../types";
import type { ArmSpec, CanaryDraft } from "../types";
import { LAYER_ORDER } from "../types";

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
    if (value === null) { delete out[key]; continue; }
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

export function isExactChartVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version);
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

export function effectiveArmValues(arm: ArmSpec): JsonObject {
  return arm.layers
    ? arm.layers.reduce((out, layer) => mergeObjects(out, layer.values ?? {}), {} as JsonObject)
    : (arm.values ?? {});
}

export function canarySystemValues(draft: Pick<CanaryDraft, "name" | "namespace" | "route">, arm: string): JsonObject {
  const release = `${draft.name}-${arm}`;
  const proxy = `${draft.name}-openresty-${arm}`;
  return {
    fullnameOverride: release,
    scaler: { enabled: false },
    cart: { enabled: true, fullnameOverride: `${release}-cart` },
    sloRequirement: { enabled: false },
    modelRoute: {
      enabled: true,
      name: release,
      nginx: {
        route: (draft.route.path ?? "").replace(/^\/+|\/+$/g, ""),
        service: `${draft.namespace}/${proxy}`,
        outputConfigMap: `${draft.namespace}/${proxy}-conf`,
      },
    },
  };
}
