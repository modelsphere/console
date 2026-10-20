import { apiPath, hostFetch } from "@swiss/lib/host";
import { catalogTokenKey, writableCatalogs, type CatalogChange } from "@/modules/inferences/catalog-write-lib";

export { catalogTokenKey };

// A writable catalog's catalog-server API (model-catalog's docs/openapi.yaml),
// through swissd at /api/catalogs/<name>/api/v2/, which adds the token it keeps
// in its Secret (swiss's docs/swiss-design.md). Paths are catalog-server's.

export interface WriteResult {
  // The new tip; the current one when unchanged; null for a dry run.
  commit: string | null;
  dryRun?: true;
  unchanged?: true;
  path: string;
  version?: string;
  digest?: string;
  deleted?: true;
}

// A refused write: every problem on a 422, the file's current digest on a 412
// or 428. tokenRejected is catalog-server's own 401, not a session's: the token
// swissd holds was changed or removed there since it was set.
export class CatalogWriteError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problems: string[] = [],
    readonly current?: string | null,
    readonly tokenRejected = false,
  ) {
    super(message);
  }
}

export interface WriteOptions {
  dryRun?: boolean;
  message?: string;
}

function catalogAPI(catalog: string, path: string, opts: WriteOptions = {}) {
  const q = new URLSearchParams();
  if (opts.dryRun) q.set("dryRun", "true");
  // The query, not X-Commit-Message: a header cannot carry non-Latin-1 text.
  if (opts.message?.trim()) q.set("message", opts.message.trim());
  return apiPath(`/api/catalogs/${encodeURIComponent(catalog)}/api/v2/${path}${q.size ? `?${q}` : ""}`);
}

// The catalog-server paths of the files the pages edit.
export const variantFile = (model: string, id: string) => `models/${encodeURIComponent(model)}/variants/${encodeURIComponent(id)}`;
export const metadataFile = (model: string) => `models/${encodeURIComponent(model)}/metadata`;
export const SETTINGS_FILE = "catalog";

// A plain-text body says which server refused: swissd's router and
// catalog-server both answer a 405 that way.
async function fail(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let body: { error?: unknown; problems?: unknown; current?: string | null } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  const problems = Array.isArray(body?.problems) ? body.problems.filter((p: unknown): p is string => typeof p === "string") : [];
  const message = typeof body?.error === "string" ? body.error : text.trim() || res.statusText || `HTTP ${res.status}`;
  const tokenRejected = res.status === 401 && /realm="catalog"/.test(res.headers.get("WWW-Authenticate") ?? "");
  throw new CatalogWriteError(res.status, `${message} (HTTP ${res.status})`, problems, body?.current, tokenRejected);
}

// A file, with the digest a write names.
export async function readFile(catalog: string, file: string): Promise<{ text: string; etag: string }> {
  const res = await hostFetch(catalogAPI(catalog, file), { cache: "no-store" });
  if (!res.ok) await fail(res);
  return { text: await res.text(), etag: res.headers.get("ETag") ?? "" };
}

// Adds the file (create) or replaces the one read at etag.
export async function putFile(catalog: string, file: string, text: string, at: { etag: string } | { create: true }, opts: WriteOptions = {}): Promise<WriteResult> {
  const headers: Record<string, string> = { "Content-Type": "application/yaml" };
  if ("etag" in at) headers["If-Match"] = at.etag;
  else headers["If-None-Match"] = "*";
  const res = await hostFetch(catalogAPI(catalog, file, opts), { method: "PUT", headers, body: text });
  if (!res.ok) await fail(res);
  return res.json();
}

export const readVariant = (catalog: string, model: string, id: string) => readFile(catalog, variantFile(model, id));

export const putVariant = (catalog: string, model: string, id: string, text: string, at: { etag: string } | { create: true }, opts: WriteOptions = {}) =>
  putFile(catalog, variantFile(model, id), text, at, opts);

export async function deleteVariant(catalog: string, model: string, id: string, etag: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const res = await hostFetch(catalogAPI(catalog, variantFile(model, id), opts), { method: "DELETE", headers: { "If-Match": etag } });
  if (!res.ok) await fail(res);
  return res.json();
}

// Whether the catalog is set up: an empty repository takes no write but init.
export async function initState(catalog: string): Promise<{ initialized: boolean; commit: string | null }> {
  const res = await hostFetch(catalogAPI(catalog, "init"), { cache: "no-store" });
  if (!res.ok) await fail(res);
  return res.json();
}

// Sets an empty catalog up: catalog-server commits its template's files, with
// where the catalog is served (site) and its repository.
export async function initCatalog(catalog: string, at: { site?: string; repo?: string }, opts: WriteOptions = {}): Promise<{ commit: string | null; files: string[] }> {
  const res = await hostFetch(catalogAPI(catalog, "init", opts), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(at) });
  if (!res.ok) await fail(res);
  return res.json();
}

// A new model: its metadata.yaml and first variants, in one commit.
export async function createModel(catalog: string, files: { metadata: string; variants: string[] }, opts: WriteOptions = {}): Promise<WriteResult> {
  const res = await hostFetch(catalogAPI(catalog, "models", opts), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(files),
  });
  if (!res.ok) await fail(res);
  return res.json();
}

// swissd's Secret: keys are listed, values only ever written.

export interface Secrets {
  secret: string;
  keys: string[];
}

// A swissd from before it listed an absent Secret as [] sends keys: null.
async function secrets(res: Response): Promise<Secrets> {
  if (!res.ok) await fail(res);
  const body = await res.json();
  return { secret: body?.secret ?? "", keys: Array.isArray(body?.keys) ? body.keys : [] };
}

export async function listSecrets(): Promise<Secrets> {
  return secrets(await hostFetch(apiPath("/api/secrets")));
}

// Updates a catalog: only a writable one's token yet -- a new one, or the one
// stored for its name before a rename -- the rest being the site profile's.
// swissd keeps the token only once the catalog's catalog-server is reached and
// takes it in a dry-run write: 422 when it refuses it, 502 when it cannot be
// reached. A dry run keeps nothing: it checks the token given, or else the one
// stored, at url, so a catalog the profile does not hold yet, or not at that
// url, is checked before it is saved.
export async function putCatalog(catalog: string, change: { token?: string; renamedFrom?: string; url?: string }, opts: { dryRun?: boolean } = {}): Promise<void> {
  const res = await hostFetch(apiPath(`/api/catalogs/${encodeURIComponent(catalog)}${opts.dryRun ? "?dryRun=true" : ""}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!res.ok) await fail(res);
}

export async function removeSecret(key: string): Promise<Secrets> {
  return secrets(await hostFetch(apiPath(`/api/secrets/${encodeURIComponent(key)}`), { method: "DELETE" }));
}

// f for each change; the ones it failed, by catalog name, are the answer.
async function eachChange(changes: CatalogChange[], f: (c: CatalogChange) => Promise<void>) {
  const refused: Record<string, Error> = {};
  for (const c of changes) {
    try {
      await f(c);
    } catch (err) {
      refused[c.name] = err instanceof Error ? err : new Error(String(err));
    }
  }
  return refused;
}

// Before a profile save: each change tried at the url the form gives its
// catalog, keeping nothing.
export async function checkCatalogChanges(changes: CatalogChange[]): Promise<Record<string, Error>> {
  return eachChange(changes, ({ name, ...change }) => putCatalog(name, change, { dryRun: true }));
}

// After a profile save: the tokens typed or carried over by a rename set, and
// the token of every catalog no longer writable removed, so the Secret holds
// what the profile says. The ones not kept, by catalog name, are the answer: one
// its catalog refused leaves the token before it.
export async function syncCatalogTokens(profile: { catalogs?: { name: string }[] } | undefined, changes: CatalogChange[]): Promise<Record<string, Error>> {
  const writable = writableCatalogs(profile);
  const sets = changes.filter((c) => writable.includes(c.name) && (c.token || c.renamedFrom));
  const refused = await eachChange(sets, ({ name, token, renamedFrom }) => putCatalog(name, token ? { token } : { renamedFrom }));
  const { keys } = await listSecrets();
  for (const key of keys) {
    const name = /^catalog\.(.+)\.token$/.exec(key)?.[1];
    if (name && !writable.includes(name)) await removeSecret(key);
  }
  return refused;
}
