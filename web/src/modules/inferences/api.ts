import { apiFetch, ApiError } from "@/shell";
import type { RouteDirective, RouteOptions } from "./routeOptions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isDirective(v: unknown): v is RouteDirective {
  if (!isRecord(v)) return false;
  return ["key", "label", "group", "fallback", "detail"].every((k) => typeof v[k] === "string")
    && ["number", "boolean", "text"].includes(String(v.kind))
    && typeof v.set === "boolean"
    && (v.needsAdaptive === undefined || typeof v.needsAdaptive === "boolean")
    && (v.value === null || ["number", "boolean", "string"].includes(typeof v.value));
}

export async function readRouteOptions(route?: string, signal?: AbortSignal): Promise<RouteOptions | null> {
  const query = route ? `?${new URLSearchParams({ route })}` : "";
  const res = await apiFetch(`/api/llm/route-options${query}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : res.statusText);
  }
  const body: unknown = await res.json();
  if (!isRecord(body) || typeof body.route !== "string" || !body.route
    || !Array.isArray(body.directives) || !body.directives.every(isDirective)
    || !Array.isArray(body.advanced) || !body.advanced.every(isDirective)) {
    throw new Error("Invalid route options response");
  }
  const keys = [...body.directives, ...body.advanced].map((d) => d.key);
  if (new Set(keys).size !== keys.length) throw new Error("Invalid route options response");
  return body as unknown as RouteOptions;
}
