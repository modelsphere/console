import { describe, expect, it } from "vitest";
import { FALLBACK_ROUTE_OPTIONS, curate, routeDirectives, runtimeValue, type RouteDirective } from "./routeOptions";

describe("legacy catalog", () => {
  it("does not infer legacy support from pending or failed query data", () => {
    expect(routeDirectives()).toEqual([]);
    expect(routeDirectives(undefined)).toEqual([]);
    expect(routeDirectives(null)).toEqual([...FALLBACK_ROUTE_OPTIONS.directives, ...FALLBACK_ROUTE_OPTIONS.advanced]);
  });

  it("keeps a successful empty catalog distinct from legacy fallback", () => {
    expect(routeDirectives({ route: "model", directives: [], advanced: [] })).toEqual([]);
  });

  it("contains all 13 common and 25 advanced options without asserting engine defaults or route values", () => {
    expect(FALLBACK_ROUTE_OPTIONS.directives).toHaveLength(13);
    expect(FALLBACK_ROUTE_OPTIONS.advanced).toHaveLength(25);
    for (const d of routeDirectives(null)) {
      expect(d.fallback).toBe("");
      expect(d.value).toBeUndefined();
      expect(d.set).toBeUndefined();
    }
  });
  it("keeps null, false and zero distinct", () => {
    expect([null, false, true, 0, "the floor"].map(runtimeValue)).toEqual(["-", "off", "on", "0", "the floor"]);
  });
});

describe("default_max", () => {
  const peerMax: RouteDirective = { key: "default_max", label: "Default peer maximum", group: "Capacity & failover", kind: "number", fallback: "20", detail: "", value: 20, set: false };
  const tries: RouteDirective = { ...peerMax, key: "max_more_tries", label: "Retry budget" };

  it("is only an advanced option, live or bundled", () => {
    expect(curate({ route: "model", directives: [peerMax, tries], advanced: [] })).toEqual({ route: "model", directives: [tries], advanced: [peerMax] });
    expect(FALLBACK_ROUTE_OPTIONS.directives.map((d) => d.key)).not.toContain("default_max");
    expect(FALLBACK_ROUTE_OPTIONS.advanced.map((d) => d.key)).toContain("default_max");
  });
});

describe("static TTFT/TPS thresholds", () => {
  const ttft: RouteDirective = { key: "ttft_limit_ms", label: "TTFT threshold", group: "Thresholds", kind: "number", fallback: "", detail: "", value: 8000, set: true };
  const tps: RouteDirective = { ...ttft, key: "tps_limit_tps", label: "Decode rate threshold", value: 20 };
  const tries: RouteDirective = { ...ttft, key: "max_more_tries", label: "Retry budget" };

  it("are not offered, live or bundled", () => {
    expect(curate({ route: "model", directives: [ttft, tries], advanced: [tps] })).toEqual({ route: "model", directives: [tries], advanced: [] });
    expect(routeDirectives(null).map((d) => d.key)).not.toContain("ttft_limit_ms");
    expect(routeDirectives(null).map((d) => d.key)).not.toContain("tps_limit_tps");
  });
});
