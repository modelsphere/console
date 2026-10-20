// What the variant editor reads off, and writes into, a variant file's text.
// Only top-level scalars, by line: the file is sent back byte for byte, so it
// is never parsed and re-emitted.

const line = (key: string) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*(?:#.*)?$`, "m");

export function topLevel(text: string, key: string): string | undefined {
  const m = line(key).exec(text);
  if (!m) return undefined;
  const v = m[1];
  const quoted = /^(["'])(.*)\1$/.exec(v);
  return quoted ? quoted[2] : v || undefined;
}

// Replaces a top-level scalar's value, keeping its quoting; appends the key
// when the file has none.
export function setTopLevel(text: string, key: string, value: string): string {
  const m = line(key).exec(text);
  if (!m) return `${text.replace(/\n*$/, "\n")}${key}: ${JSON.stringify(value)}\n`;
  const q = /^["']/.exec(m[1])?.[0] ?? (key === "version" ? '"' : "");
  const at = m.index + m[0].indexOf(m[1], key.length + 1);
  const before = text.slice(0, at);
  return `${m[1] ? before : before.replace(/[ \t]*$/, " ")}${q}${value}${q}${text.slice(at + m[1].length)}`;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// The version catalog-server suggests after v: a prerelease's release, else
// the next patch.
export function nextVersion(v: string): string | undefined {
  const m = SEMVER.exec(v);
  if (!m) return undefined;
  if (v.includes("-")) return `${m[1]}.${m[2]}.${m[3]}`;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function bumpVersion(text: string): string {
  const v = topLevel(text, "version");
  const next = v && nextVersion(v);
  return next ? setTopLevel(text, "version", next) : text;
}

// A new variant starts as a copy of another: same engine, chart and values,
// under a new id at 1.0.0.
export function variantFrom(text: string, id: string): string {
  return setTopLevel(setTopLevel(text, "id", id), "version", "1.0.0");
}

// A new model's first files. The variant starts as a copy of one the catalog
// has, when it has any: real chart, image and values to change, not blanks.
export function newModelFiles(name: string, variant: string, from?: string) {
  const metadata = `apiVersion: catalog.swiss/v2
name: ${name}
displayName: ${name}
# description, family, tags, ...: model-catalog's schema/metadata.v2.schema.json
defaultVariant: ${variant}
source:
  hf: org/${name}
`;
  const base =
    from ??
    `apiVersion: catalog.swiss/v2
kind: Variant
model: ${name}
id: ${variant}
version: 1.0.0
engine: sglang
chart:
  name: sglang
  version: 0.8.0
requires:
  gpus: 1
values: {}
`;
  return { metadata, variant: setTopLevel(variantFrom(base, variant), "model", name) };
}

export const VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const variantPath = (model: string, id: string) => `models/${model}/${id}.yaml`;

export function idProblem(id: string, taken: string[]): "invalid" | "taken" | undefined {
  if (!VARIANT_ID.test(id) || id === "metadata") return "invalid";
  return taken.includes(id) ? "taken" : undefined;
}

export function freeId(base: string, taken: string[]): string {
  let id = `${base}-copy`;
  for (let n = 2; taken.includes(id); n++) id = `${base}-copy-${n}`;
  return id;
}

// The catalogs the site profile marks writable. The copied swiss types predate
// the field.
export function writableCatalogs(profile: { catalogs?: { name: string }[] } | undefined): string[] {
  return (profile?.catalogs ?? []).filter((c) => (c as { writable?: boolean }).writable === true).map((c) => c.name);
}

export function markedWritable(profile: { catalogs?: { name: string }[] } | undefined, catalog: string): boolean {
  return writableCatalogs(profile).includes(catalog);
}

export const catalogTokenKey = (catalog: string) => `catalog.${catalog}.token`;

// What saving the profile asks of a writable catalog's token: a typed one; else,
// with one stored, the one stored under its old name (renamedFrom), or, when its
// url changed, the one stored, checked there.
export interface CatalogChange {
  name: string;
  url: string;
  token?: string;
  renamedFrom?: string;
}

type Catalogs = { catalogs?: { name: string; url: string }[] } | undefined;

export function catalogChanges(form: Catalogs, saved: Catalogs, typed: Record<string, string>, renamedFrom: Record<string, string>, stored: string[]): CatalogChange[] {
  const savedUrl = new Map((saved?.catalogs ?? []).map((c) => [c.name, c.url]));
  const writable = writableCatalogs(form);
  return (form?.catalogs ?? []).flatMap(({ name, url }): CatalogChange[] => {
    if (!writable.includes(name)) return [];
    if (typed[name]) return [{ name, url, token: typed[name] }];
    const from = renamedFrom[name];
    if (!stored.includes(catalogTokenKey(from ?? name))) return [];
    if (from) return [{ name, url, renamedFrom: from }];
    return savedUrl.get(name) !== url ? [{ name, url }] : [];
  });
}
