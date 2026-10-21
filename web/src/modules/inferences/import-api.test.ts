import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmImport, importOptions, previewImport, type ImportPreview, type ImportSelection } from "./import-api";

const fetchMock = vi.fn();
const selection: ImportSelection = { namespace: "models", release: "existing", catalog: "private", model: "weights", variant: "sglang" };
const preview = { revision: 7, secretUID: "uid-7", resourceVersion: "rv-11", chart: "sglang-0.9.22", plan: { hash: "sha256:preview" }, warnings: [] } as unknown as ImportPreview;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { cookie: "token=test-session" });
});
afterEach(() => vi.unstubAllGlobals());

function call() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, headers: new Headers(init.headers), body: init.body && JSON.parse(String(init.body)) };
}

describe("Console deployment import client", () => {
  it("treats an older Console without the endpoint as disabled", async () => {
    fetchMock.mockResolvedValue(json({ error: "not found" }, 404));
    expect(await importOptions()).toEqual({ enabled: false, namespaces: [] });
  });

  it("does not disguise permission or connection failures as a disabled feature", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "forbidden" }, 403));
    await expect(importOptions()).rejects.toMatchObject({ status: 403 });
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));
    await expect(importOptions()).rejects.toThrow("network unavailable");
  });

  it("reads the explicit namespace list with the Console session", async () => {
    fetchMock.mockResolvedValue(json({ enabled: true, namespaces: ["models"] }));
    expect(await importOptions()).toEqual({ enabled: true, namespaces: ["models"] });
    expect(call()).toMatchObject({ url: "/api/deployment-imports", method: "GET" });
    expect(call().headers.get("Authorization")).toBe("Bearer test-session");
  });

  it("previews an existing release through the Console backend without applying it", async () => {
    fetchMock.mockResolvedValue(json(preview));
    expect(await previewImport(selection)).toEqual(preview);
    expect(call()).toMatchObject({ url: "/api/deployment-imports/preview", method: "POST", body: selection });
  });

  it("confirms exactly the previewed Helm identity, revision and plan hash", async () => {
    fetchMock.mockResolvedValue(json({ namespace: "models", release: "existing", revision: 7, planHash: preview.plan.hash }));
    await confirmImport(selection, preview);
    expect(call()).toMatchObject({
      url: "/api/deployment-imports", method: "POST", body: {
        ...selection, expectedRevision: 7, expectedSecretUID: "uid-7", expectedResourceVersion: "rv-11", expectedPlanHash: "sha256:preview",
      },
    });
    expect(call().body).not.toHaveProperty("plan");
    expect(call().body).not.toHaveProperty("overrides");
  });

  it("propagates stale previews for the form to invalidate and re-preview", async () => {
    fetchMock.mockResolvedValue(json({ error: "release changed; preview again" }, 409));
    await expect(confirmImport(selection, preview)).rejects.toMatchObject({ status: 409, message: "release changed; preview again" });
  });
});
