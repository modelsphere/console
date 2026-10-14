import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_ROUTE_OPTIONS, readRouteOptions, routeDirectives, runtimeValue } from "./route-options";

const fetchMock = vi.fn();
const catalog = {
  route: "model",
  directives: [{ key: "new_engine_option", label: "New option", group: "Future group", kind: "number", fallback: "73", detail: "Engine help", value: 81, set: true }],
  advanced: [],
  peers: { count: 3 },
  adaptive_cc_derived: { _: { static_max: 200, min: 80, init: 80 } },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { cookie: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("route options transport", () => {
  it("reads an existing route, preserves host defaults and derived state, and accepts unknown options", async () => {
    fetchMock.mockResolvedValue(response(catalog));
    expect(await readRouteOptions("model.with-dots")).toEqual(catalog);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/llm/route-options?route=model.with-dots");
  });
  it("uses a catalog-only probe for a new deployment", async () => {
    fetchMock.mockResolvedValue(response(catalog));
    await readRouteOptions();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/llm/route-options");
  });
  it("uses legacy metadata only for a 404", async () => {
    fetchMock.mockResolvedValue(response({ error: "no catalog" }, 404));
    expect(await readRouteOptions()).toBeNull();
  });
  it.each([401, 403, 500, 502, 503])("surfaces HTTP %s rather than silently using legacy defaults", async (status) => {
    fetchMock.mockResolvedValue(response({ error: "catalog failed" }, status));
    await expect(readRouteOptions()).rejects.toThrow("catalog failed");
  });
  it.each([
    {}, { ...catalog, directives: null }, { ...catalog, advanced: null },
    { ...catalog, directives: [{ ...catalog.directives[0], value: {} }] },
    { ...catalog, directives: [{ ...catalog.directives[0], set: "false" }] },
    { ...catalog, advanced: catalog.directives },
  ])("rejects invalid catalog data", async (body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(readRouteOptions()).rejects.toThrow("Invalid route options response");
  });
});

describe("legacy catalog", () => {
  it("contains all 16 common and 24 advanced options without asserting engine defaults or route values", () => {
    expect(FALLBACK_ROUTE_OPTIONS.directives).toHaveLength(16);
    expect(FALLBACK_ROUTE_OPTIONS.advanced).toHaveLength(24);
    for (const d of routeDirectives()) {
      expect(d.fallback).toBe("");
      expect(d.value).toBeUndefined();
      expect(d.set).toBeUndefined();
    }
  });
  it("keeps null, false and zero distinct", () => {
    expect([null, false, true, 0, "the floor"].map(runtimeValue)).toEqual(["-", "off", "on", "0", "the floor"]);
  });
});
