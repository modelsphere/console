import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRouteOptions } from "./api";

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
    await expect(readRouteOptions()).rejects.toMatchObject({ status, message: "catalog failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("surfaces non-JSON API failures", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }));
    await expect(readRouteOptions()).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
  it("surfaces network failures instead of reporting a legacy catalog", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network unavailable"));
    await expect(readRouteOptions()).rejects.toThrow("Network unavailable");
  });
  it("surfaces malformed JSON instead of reporting a legacy catalog", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));
    await expect(readRouteOptions()).rejects.toBeInstanceOf(SyntaxError);
  });
  it("forwards query cancellation to the transport", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response(catalog));
    await readRouteOptions("model", controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it.each([
    {}, { ...catalog, route: "" }, { ...catalog, directives: null }, { ...catalog, advanced: null },
    { ...catalog, directives: [{ ...catalog.directives[0], value: {} }] },
    { ...catalog, directives: [{ ...catalog.directives[0], set: "false" }] },
    { ...catalog, advanced: catalog.directives },
  ])("rejects invalid catalog data", async (body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(readRouteOptions()).rejects.toThrow("Invalid route options response");
  });
});
