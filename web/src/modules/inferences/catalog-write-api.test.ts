import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogTokenKey, createModel, deleteVariant, initCatalog, listSecrets, metadataFile, putFile, putVariant, readVariant, removeSecret, setSecret, SETTINGS_FILE, syncCatalogTokens } from "./catalog-write-api";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { cookie: "" });
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body };
};

describe("variant writes, through swissd", () => {
  it("reads the file with the digest a write names", async () => {
    fetchMock.mockResolvedValue(new Response("id: a\n", { headers: { ETag: '"sha256:1"' } }));
    expect(await readVariant("in ternal", "kimi", "a")).toEqual({ text: "id: a\n", etag: '"sha256:1"' });
    expect(call().url).toBe("/api/deploy/catalogs/in%20ternal/api/v2/models/kimi/variants/a");
  });

  it("replaces at the digest read, a message the header could not carry in the query", async () => {
    fetchMock.mockResolvedValue(json({ commit: null, dryRun: true, path: "models/kimi/a.yaml" }));
    await putVariant("c", "kimi", "a", "id: a\n", { etag: '"sha256:1"' }, { dryRun: true, message: " 调整显存 " });
    const c = call();
    expect(c.method).toBe("PUT");
    expect(c.url).toBe(`/api/deploy/catalogs/c/api/v2/models/kimi/variants/a?dryRun=true&message=${encodeURIComponent("调整显存")}`);
    expect(c.headers.get("If-Match")).toBe('"sha256:1"');
    expect(c.headers.get("If-None-Match")).toBeNull();
    expect(c.body).toBe("id: a\n");
  });

  it("adds only where there is no file", async () => {
    fetchMock.mockResolvedValue(json({ commit: "abc", path: "models/kimi/b.yaml" }, 201));
    await putVariant("c", "kimi", "b", "id: b\n", { create: true });
    expect(call().headers.get("If-None-Match")).toBe("*");
  });

  it("says which server refused, from a plain-text body", async () => {
    fetchMock.mockResolvedValue(new Response("GET only, but under api/v2/\n", { status: 405, statusText: "Method Not Allowed" }));
    await expect(createModel("c", { metadata: "", variants: [] })).rejects.toMatchObject({ status: 405, message: "GET only, but under api/v2/ (HTTP 405)" });
  });

  it("carries every problem of a refusal", async () => {
    fetchMock.mockResolvedValue(json({ error: "not a change this catalog takes", problems: ["version: send 1.0.3 or above", 7] }, 422));
    await expect(deleteVariant("c", "kimi", "a", '"sha256:1"')).rejects.toMatchObject({
      status: 422,
      message: "not a change this catalog takes (HTTP 422)",
      problems: ["version: send 1.0.3 or above"],
    });
    expect(call().headers.get("If-Match")).toBe('"sha256:1"');
  });

  it("says what changed under a stale edit", async () => {
    fetchMock.mockResolvedValue(json({ error: "changed since it was read", current: "sha256:2" }, 412));
    await expect(putVariant("c", "kimi", "a", "x", { etag: '"sha256:1"' })).rejects.toMatchObject({ status: 412, current: "sha256:2" });
  });
});

it("creates a model with its files as JSON, in the catalog's collection", async () => {
  fetchMock.mockResolvedValue(json({ commit: "abc", path: "models/m/metadata.yaml" }, 201));
  await createModel("c", { metadata: "name: m\n", variants: ["id: a\n"] }, { message: "新增" });
  const c = call();
  expect(c.method).toBe("POST");
  expect(c.url).toBe(`/api/deploy/catalogs/c/api/v2/models?message=${encodeURIComponent("新增")}`);
  expect(c.body).toBe('{"metadata":"name: m\\n","variants":["id: a\\n"]}');
});

it("edits settings and a model's metadata at the digest read, and sets a catalog up, by catalog-server's paths", async () => {
  fetchMock.mockImplementation(async () => json({ commit: "abc", path: "x", files: [] }));
  await putFile("c", SETTINGS_FILE, "site: x\n", { etag: '"sha256:1"' });
  await putFile("c", metadataFile("kimi"), "name: kimi\n", { etag: '"sha256:2"' }, { dryRun: true });
  await initCatalog("c", { site: "https://c.example/", repo: "https://c.example" }, { dryRun: true });
  expect([0, 1, 2].map((i) => `${call(i).method} ${call(i).url}`)).toEqual([
    "PUT /api/deploy/catalogs/c/api/v2/catalog",
    "PUT /api/deploy/catalogs/c/api/v2/models/kimi/metadata?dryRun=true",
    "POST /api/deploy/catalogs/c/api/v2/init?dryRun=true",
  ]);
  expect(call(0).headers.get("If-Match")).toBe('"sha256:1"');
  expect(call(2).body).toBe('{"site":"https://c.example/","repo":"https://c.example"}');
});

describe("swissd's Secret", () => {
  it("lists no keys as an empty list, whatever swissd sends for none", async () => {
    fetchMock.mockImplementation(async () => json({ secret: "s", keys: null }));
    expect(await listSecrets()).toEqual({ secret: "s", keys: [] });
    const profile = { catalogs: [{ name: "a", writable: true }] };
    await syncCatalogTokens(profile, {});
  });

  it("sets and removes a catalog's token by key", async () => {
    fetchMock.mockImplementation(async () => json({ secret: "swiss/p-secrets", keys: [] }));
    await setSecret(catalogTokenKey("internal"), "t0k");
    expect(call(0).url).toBe("/api/deploy/secrets/catalog.internal.token");
    expect(call(0).method).toBe("PUT");
    expect(call(0).body).toBe('{"value":"t0k"}');
    await removeSecret(catalogTokenKey("internal"));
    expect(call(1).method).toBe("DELETE");
  });

  it("follows a saved profile: typed tokens of writable catalogs set, others' tokens removed", async () => {
    fetchMock.mockImplementation(async () => json({ secret: "s", keys: ["catalog.internal.token", "catalog.gone.token"] }));
    const profile = { catalogs: [{ name: "internal", writable: true }, { name: "public" }] };
    await syncCatalogTokens(profile, { internal: "new", public: "ignored" });
    const calls = fetchMock.mock.calls.map((_, i) => `${call(i).method} ${call(i).url}`);
    expect(calls).toEqual([
      "PUT /api/deploy/secrets/catalog.internal.token",
      "GET /api/deploy/secrets",
      "DELETE /api/deploy/secrets/catalog.gone.token",
    ]);
  });
});
