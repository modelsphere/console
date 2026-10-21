import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModel, deleteVariant, initCatalog, listSecrets, metadataFile, putFile, putVariant, readVariant, putCatalog, SETTINGS_FILE, syncCatalogTokens, checkCatalogChanges } from "./catalog-write-api";

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

  it("tells catalog-server's 401, a token it no longer takes, from a session's", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "that token is not in the server's tokensFile" }), { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="catalog"' } }),
    );
    await expect(putVariant("c", "kimi", "a", "x", { etag: '"sha256:1"' })).rejects.toMatchObject({ status: 401, tokenRejected: true });
    fetchMock.mockResolvedValueOnce(json({ error: "unauthenticated" }, 401));
    await expect(putVariant("c", "kimi", "a", "x", { etag: '"sha256:1"' })).rejects.toMatchObject({ status: 401, tokenRejected: false });
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
  });

  it("sets a catalog's token by updating the catalog", async () => {
    fetchMock.mockImplementation(async () => json({ name: "internal", tokenSet: true }));
    await putCatalog("internal", { token: "t0k" });
    expect(call(0).url).toBe("/api/deploy/catalogs/internal");
    expect(call(0).method).toBe("PUT");
    expect(call(0).body).toBe('{"token":"t0k"}');
  });

  it("tries each typed token at the form's url before the profile is saved, keeping nothing", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/catalogs/b?") ? json({ error: "cannot check the token with catalog b: connection refused" }, 502) : json({ name: "a", dryRun: true }),
    );
    const refused = await checkCatalogChanges([
      { name: "a", url: "https://a.example/", token: "tok-a" },
      { name: "b", url: "https://b.example/", token: "tok-b" },
    ]);
    expect(Object.keys(refused)).toEqual(["b"]);
    expect(refused.b).toMatchObject({ status: 502 });
    expect(fetchMock.mock.calls.map((_, i) => `${call(i).method} ${call(i).url} ${call(i).body}`)).toEqual([
      'PUT /api/deploy/catalogs/a?dryRun=true {"token":"tok-a","url":"https://a.example/"}',
      'PUT /api/deploy/catalogs/b?dryRun=true {"token":"tok-b","url":"https://b.example/"}',
    ]);
  });

  it("follows a saved profile: typed tokens set, those of catalogs changed, removed or unticked deleted", async () => {
    fetchMock.mockImplementation(async (_: string, init: RequestInit) =>
      init.method === "PUT" ? json({ tokenSet: true }) : json({ secret: "s", keys: ["catalog.kept.token", "catalog.moved.token", "catalog.retyped.token", "catalog.before.token", "catalog.ro.token"] }),
    );
    const w = (name: string, url: string, writable = true) => ({ name, url, schemaVersion: "v2", writable });
    const before = { catalogs: [w("kept", "https://k/"), w("moved", "https://old/"), w("retyped", "https://r/"), w("before", "https://b/"), w("ro", "https://ro/")] };
    const after = { catalogs: [{ ...w("kept", "https://k/"), default: true }, w("moved", "https://new/"), w("retyped", "https://r2/"), w("after", "https://b/"), w("ro", "https://ro/", false)] };
    expect(await syncCatalogTokens(before, after, [{ name: "retyped", url: "https://r2/", token: "new" }])).toEqual({});
    expect(fetchMock.mock.calls.map((_, i) => `${call(i).method} ${call(i).url}`)).toEqual([
      "PUT /api/deploy/catalogs/retyped",
      "GET /api/deploy/secrets",
      "DELETE /api/deploy/secrets/catalog.moved.token",
      "DELETE /api/deploy/secrets/catalog.before.token",
      "DELETE /api/deploy/secrets/catalog.ro.token",
    ]);
  });

  it("goes on past a token its catalog refused, and says which", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) =>
      init.method === "PUT" && url.endsWith("/catalogs/a")
        ? json({ error: "catalog a does not take this token: that token is not in the server's tokensFile" }, 422)
        : json({ secret: "s", keys: [] }),
    );
    const profile = { catalogs: [{ name: "a", url: "u", writable: true }, { name: "b", url: "u", writable: true }] };
    const refused = await syncCatalogTokens(profile, profile, [
      { name: "a", url: "u", token: "typo" },
      { name: "b", url: "u", token: "good" },
    ]);
    expect(Object.keys(refused)).toEqual(["a"]);
    expect(refused.a).toMatchObject({ status: 422, message: "catalog a does not take this token: that token is not in the server's tokensFile (HTTP 422)" });
    expect(fetchMock.mock.calls.map((_, i) => `${call(i).method} ${call(i).url} ${call(i).body ?? ""}`.trim())).toEqual([
      'PUT /api/deploy/catalogs/a {"token":"typo"}',
      'PUT /api/deploy/catalogs/b {"token":"good"}',
      "GET /api/deploy/secrets",
    ]);
  });
});
