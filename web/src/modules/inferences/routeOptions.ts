import { DIRECTIVES, type Directive } from "@swiss/lib/routeDirectives";

export type RouteValue = string | number | boolean | null;
export interface RouteDirective extends Directive {
  value?: RouteValue;
  set?: boolean;
}
export interface RouteOptions {
  route: string;
  directives: RouteDirective[];
  advanced: RouteDirective[];
  peers?: { count: number };
  adaptive_cc_derived?: Record<string, { static_max: number; min: number; init: number }>;
}

const common = new Set([
  "adaptive_cc", "adaptive_cc_min", "adaptive_cc_min_frac", "adaptive_cc_init", "adaptive_cc_init_frac", "adaptive_cc_hold_when_idle", "adaptive_cc_use_ttft",
  "tps_limit_tps", "ttft_limit_ms", "default_max", "max_more_tries", "cross_tier_fallback", "health_probe_path", "session_affinity_enabled", "expose_routed_peer", "bodylog_default_pct",
]);
const additions: Directive[] = [
  { key: "adaptive_cc", label: "Adaptive concurrency", group: "Adaptive concurrency", kind: "boolean", fallback: "", detail: "Adjust the pool limit using measured performance." },
  { key: "adaptive_cc_min_frac", label: "Floor fraction", group: "Adaptive concurrency", kind: "number", fallback: "", detail: "Fraction of the static maximum used as the floor; greater than zero and at most one.", needsAdaptive: true },
  { key: "adaptive_cc_init", label: "Start point", group: "Adaptive concurrency", kind: "number", fallback: "", detail: "Absolute initial pool limit.", needsAdaptive: true },
  { key: "adaptive_cc_init_frac", label: "Start fraction", group: "Adaptive concurrency", kind: "number", fallback: "", detail: "Fraction of the static maximum used as the initial limit.", needsAdaptive: true },
  { key: "adaptive_cc_hold_when_idle", label: "Hold when idle", group: "Adaptive concurrency", kind: "boolean", fallback: "", detail: "Keep the learned limit when idle instead of returning to the start point.", needsAdaptive: true },
  { key: "tps_limit_tps", label: "Decode rate threshold", group: "Thresholds", kind: "number", fallback: "", detail: "Static decode-rate threshold, used when no TPS metrics are declared." },
  { key: "ttft_limit_ms", label: "TTFT threshold", group: "Thresholds", kind: "number", fallback: "", detail: "Static time-to-first-token threshold in milliseconds, used when no TTFT metrics are declared." },
  { key: "session_affinity_enabled", label: "Session affinity", group: "Routing", kind: "boolean", fallback: "", detail: "Keep requests in a session on the same peer." },
  { key: "expose_routed_peer", label: "Expose routed peer", group: "Observability", kind: "boolean", fallback: "", detail: "Return the selected peer in the X-Routed-Peer response header." },
];
const corrections: Record<string, string> = {
  adaptive_cc_ttl: "Lifetime of the idle start-point state; has no effect while hold-when-idle is enabled.",
  adaptive_cc_slack_frac: "Slack band relative to the start point; has no effect while hold-when-idle is enabled.",
  rt_limit_factor: "Scales the pool's runtime concurrency limit, not each peer's maximum.",
  max_more_tries: "Upper bound on balancer retries for one request.",
  ttft_probe_per_window: "Probe requests allowed through while TTFT limiting is active, per probe window.",
  tps_probe_per_window: "Probe requests allowed through while TPS limiting is active, per probe window.",
};
const bundled = [...DIRECTIVES.map((d) => ({ ...d, fallback: "", detail: corrections[d.key] ?? d.detail })), ...additions];
export const FALLBACK_ROUTE_OPTIONS: RouteOptions = {
  route: "",
  directives: bundled.filter((d) => common.has(d.key)),
  advanced: bundled.filter((d) => !common.has(d.key)),
};

export function routeDirectives(options?: RouteOptions | null): RouteDirective[] {
  const catalog = options === null ? FALLBACK_ROUTE_OPTIONS : options;
  return catalog ? [...catalog.directives, ...catalog.advanced] : [];
}

export function runtimeValue(value: RouteValue | undefined): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}
