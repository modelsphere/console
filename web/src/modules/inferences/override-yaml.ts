import { isMap as isYamlMap, isNode, isScalar, isSeq, parseDocument, stringify, type Document } from "yaml";

export type Values = Record<string, unknown>;
const isMap = (value: unknown): value is Values => !!value && typeof value === "object" && !Array.isArray(value);

export const valuesYaml = (values: Values) => (Object.keys(values).length ? stringify(values) : "");

// A mapping of values; an empty document is none.
export function parseValues(text: string): Values {
  return documentValues(parseDocument(text, { uniqueKeys: true }));
}

function documentValues(document: Document): Values {
  if (document.errors.length) throw new Error(document.errors[0].message);
  if (document.warnings.length) throw new Error(document.warnings[0].message);
  const values: unknown = document.toJS({ maxAliasCount: 100 });
  if (values === null || values === undefined) {
    if (document.contents !== null) throw new Error("YAML must contain a mapping of values.");
    return {};
  }
  JSON.stringify(values, (_key, value: unknown) => {
    if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("YAML integers must be within the exact JavaScript integer range.");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("YAML values must contain finite numbers.");
    if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("YAML values must contain plain mappings, lists and scalars.");
    return value;
  });
  if (!isMap(values)) throw new Error("YAML must contain a mapping of values.");
  return values;
}

// One parse of a text an editor shows: its values or why it has none, and its keys' lines.
export function readYaml(text: string): { values?: Values; error?: string; keys: KeyLine[] } {
  const document = parseDocument(text, { uniqueKeys: true });
  const keys = documentKeys(document, text);
  try {
    return { values: documentValues(document), keys };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), keys };
  }
}

// What the release renders from, written into the chart's values.yaml so its
// comments stay beside their keys. Helm's rules: maps merge key by key, lists
// and scalars replace, a null deletes the default. A key only the overrides
// set goes at the end of its map.
export function computedYaml(defaults: string, overrides: string): string {
  const document = parseDocument(defaults, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors[0].message);
  const apply = (path: string[], value: unknown) => {
    const node = document.getIn(path, true);
    if (value === null) document.deleteIn(path);
    else if (isMap(value) && isYamlMap(node)) {
      // A chart's `affinity: {}` is a flow map, and all written into one prints in flow style.
      node.flow = false;
      for (const [key, v] of Object.entries(value)) apply([...path, key], v);
    } else document.setIn(path, document.createNode(value));
  };
  for (const [key, value] of Object.entries(parseValues(overrides))) apply([key], value);
  return document.contents === null ? "" : document.toString();
}

// Helm's merge of next over previous, a null kept for helm to read as delete.
export function mergeValues(previous: Values, next: Values): Values {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(next)])].map((key) => {
    if (!Object.hasOwn(next, key)) return [key, previous[key]];
    return [key, isMap(next[key]) ? mergeValues(isMap(previous[key]) ? previous[key] : {}, next[key]) : next[key]];
  }));
}

function sameValue(previous: unknown, next: unknown): boolean {
  if (isMap(previous) && isMap(next)) return Object.keys(previous).length === Object.keys(next).length
    && Object.keys(previous).every((key) => Object.hasOwn(next, key) && sameValue(previous[key], next[key]));
  if (Array.isArray(previous) && Array.isArray(next)) return previous.length === next.length && previous.every((value, index) => sameValue(value, next[index]));
  return Object.is(previous, next);
}

// Only the paths that changed; a dropped key is null, which helm reads as delete.
function changedValues(previous: Values, next: Values): Values {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(next)])].flatMap((key) => {
    if (!Object.hasOwn(next, key)) return [[key, null]];
    if (sameValue(previous[key], next[key])) return [];
    const value = isMap(previous[key]) && isMap(next[key]) ? changedValues(previous[key], next[key]) : next[key];
    return [[key, value]];
  }));
}

function leaves(values: Values, prefix = ""): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isMap(value) && Object.keys(value).length ? leaves(value, path) : [path];
  });
}

// The smallest edit that turns base, what the release renders from, into
// final, merged into the overrides already there.
export function overrideEdit(base: Values, edits: Values, final: Values): { edits: Values; changes: number } {
  const changes = changedValues(base, final);
  return { edits: mergeValues(edits, changes), changes: leaves(changes).length };
}

export interface KeyLine {
  path: string;
  // 0-based.
  line: number;
}

// Every key in a YAML text with the line it sits on, a list item as [i]. Text
// that does not parse still yields the keys before the error.
export function keyLines(text: string): KeyLine[] {
  return documentKeys(parseDocument(text), text);
}

function documentKeys(document: Document, text: string): KeyLine[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    for (let hi = starts.length - 1; lo < hi;) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out: KeyLine[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (isYamlMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const path = prefix ? `${prefix}.${key}` : key;
        const at = isNode(pair.key) ? pair.key.range?.[0] : undefined;
        if (at !== undefined) out.push({ path, line: lineOf(at) });
        walk(pair.value, path);
      }
    } else if (isSeq(node)) node.items.forEach((item, i) => walk(item, `${prefix}[${i}]`));
  };
  walk(document.contents, "");
  return out;
}

// The keys matching query, ignoring case: a key named it first, then a path
// starting with it, then one containing it, in line order within each.
export function searchKeys(keys: KeyLine[], query: string, limit = 8): KeyLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = ({ path }: KeyLine) => {
    const p = path.toLowerCase();
    return p.slice(p.lastIndexOf(".") + 1) === q ? 0 : p.startsWith(q) ? 1 : p.includes(q) ? 2 : -1;
  };
  return keys
    .map((key) => ({ key, rank: rank(key) }))
    .filter((k) => k.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.key.line - b.key.line)
    .slice(0, limit)
    .map((k) => k.key);
}

// The overridden paths, undefined for invalid YAML.
export function overridePaths(text: string): string[] | undefined {
  try {
    return leaves(parseValues(text));
  } catch {
    return undefined;
  }
}
