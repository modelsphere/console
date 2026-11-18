// A catalog input key is a kyaml-style path: segments joined by ".", brackets
// kept whole. Helm replaces a list wholesale, so a key that passes through one
// copies that list into the form layer and patches only the matched item.

const FIELD = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const INDEX = /^(0|[1-9][0-9]*)$/;
const BRACKET = /^\[(\^?)([^=\]]*)=(.*)\]$/;

export interface Hit {
  parent: unknown;
  at: string | number | null;
  value: unknown;
}

const isPrimitive = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);
const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function splitKey(key: string): string[] {
  return key.match(/\[[^\]]*\]|[^.[]+/g) ?? [];
}

// Every segment is a plain map key. A bare number or a bracket is not.
export function isFieldKey(key: string): boolean {
  const segs = splitKey(key);
  return segs.length > 0 && segs.every((seg) => FIELD.test(seg));
}

export function findAt(values: unknown, segs: string[]): Hit[] {
  let here: Hit[] = [{ parent: null, at: null, value: values }];
  for (const seg of segs) {
    const next: Hit[] = [];
    for (const { value: node } of here) {
      const bracket = BRACKET.exec(seg);
      if (bracket && Array.isArray(node)) {
        const [, prefix, field, want] = bracket;
        node.forEach((item, i) => {
          const v = field ? (isMap(item) ? item[field] : undefined) : item;
          const ok = prefix ? typeof v === "string" && v.startsWith(want) : isPrimitive(v) && String(v) === want;
          if (ok) next.push({ parent: node, at: i, value: item });
        });
      } else if (!bracket && INDEX.test(seg) && Array.isArray(node)) {
        const i = Number(seg);
        if (i < node.length) next.push({ parent: node, at: i, value: node[i] });
      } else if (!bracket && isMap(node) && Object.hasOwn(node, seg)) {
        next.push({ parent: node, at: seg, value: node[seg] });
      }
    }
    here = next;
  }
  return here;
}

function applyPatcher(patcher: string | undefined, value: unknown): unknown {
  if (!patcher) return value;
  const parts = patcher.split("{value}");
  if (parts.length !== 2) return value;
  return parts[0] + String(value) + parts[1];
}

function stripPatcher(patcher: string | undefined, value: unknown): string | undefined {
  if (!isPrimitive(value)) return undefined;
  if (!patcher) return String(value);
  const parts = patcher.split("{value}");
  if (parts.length !== 2) return undefined;
  const [before, after] = parts;
  if (typeof value !== "string" || value.length < before.length + after.length || !value.startsWith(before) || !value.endsWith(after)) return undefined;
  return value.slice(before.length, value.length - after.length);
}

// Exactly one primitive, or no answer. A patcher that the value does not fit
// counts as unanswered: the chart value is the template, the answer is the middle.
export function readAt(root: unknown, key: string, patcher?: string): string | undefined {
  const found = findAt(root, splitKey(key));
  if (found.length !== 1) return undefined;
  return stripPatcher(patcher, found[0].value);
}

function setLeaf(layer: Record<string, unknown>, segs: string[], value: unknown) {
  let node = layer;
  for (const key of segs.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[segs[segs.length - 1]] = value;
}

function put(parent: unknown, at: string | number, value: unknown) {
  if (Array.isArray(parent)) parent[at as number] = value;
  else if (isMap(parent)) parent[at] = value;
}

// The first list a key walks through, and the field path to it.
function topList(values: unknown, segs: string[]): { path: string[]; list: unknown[] } | undefined {
  let node: unknown = values;
  const path: string[] = [];
  for (const seg of segs) {
    if (Array.isArray(node)) return path.length ? { path, list: node } : undefined;
    if (!isMap(node) || !Object.hasOwn(node, seg)) return undefined;
    path.push(seg);
    node = node[seg];
  }
  return undefined;
}

function ensureMaps(layer: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let node = layer;
  for (const key of path) {
    const next = node[key];
    if (!isMap(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  return node;
}

// Field keys create a missing leaf. Any other key writes only when variant
// values hold exactly one primitive there, and does not mutate those values.
export function writeAt(layer: Record<string, unknown>, variantValues: unknown, key: string, value: unknown, patcher?: string): boolean {
  const segs = splitKey(key);
  if (!segs.length) return false;
  const stored = applyPatcher(patcher, value);
  if (isFieldKey(key)) {
    setLeaf(layer, segs, stored);
    return true;
  }
  const found = findAt(variantValues, segs);
  if (found.length !== 1 || !isPrimitive(found[0].value)) return false;
  const located = topList(variantValues, segs);
  if (!located) {
    if (Array.isArray(variantValues)) return false;
    setLeaf(layer, segs, stored);
    return true;
  }
  const parent = ensureMaps(layer, located.path.slice(0, -1));
  const listKey = located.path[located.path.length - 1];
  const existing = parent[listKey];
  const target = Array.isArray(existing) ? existing : structuredClone(located.list);
  const hit = findAt(target, segs.slice(located.path.length));
  if (hit.length !== 1 || hit[0].parent == null || hit[0].at == null || !isPrimitive(hit[0].value)) return false;
  put(hit[0].parent, hit[0].at, stored);
  if (!Array.isArray(existing)) parent[listKey] = target;
  return true;
}
