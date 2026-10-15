import { describe, expect, it } from "vitest";
import { FALLBACK_ROUTE_OPTIONS, routeDirectives, runtimeValue } from "./routeOptions";

describe("legacy catalog", () => {
  it("does not infer legacy support from pending or failed query data", () => {
    expect(routeDirectives()).toEqual([]);
    expect(routeDirectives(undefined)).toEqual([]);
    expect(routeDirectives(null)).toEqual([...FALLBACK_ROUTE_OPTIONS.directives, ...FALLBACK_ROUTE_OPTIONS.advanced]);
  });

  it("keeps a successful empty catalog distinct from legacy fallback", () => {
    expect(routeDirectives({ route: "model", directives: [], advanced: [] })).toEqual([]);
  });

  it("contains all 16 common and 24 advanced options without asserting engine defaults or route values", () => {
    expect(FALLBACK_ROUTE_OPTIONS.directives).toHaveLength(16);
    expect(FALLBACK_ROUTE_OPTIONS.advanced).toHaveLength(24);
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
