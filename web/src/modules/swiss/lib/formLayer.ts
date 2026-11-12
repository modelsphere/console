import { isMap as isYamlMap, parseDocument } from "yaml";
import type { SiteProfile } from "@swiss/lib/api";

type Tree = Record<string, unknown>;

export const isMap = (v: unknown): v is Tree => !!v && typeof v === "object" && !Array.isArray(v);

// Key order does not make two list items different.
const canon = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (isMap(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const isEnvPath = (path: string) => path === "env" || /^pd\.[^.]+\.env$/.test(path);

const envName = (v: unknown): string | undefined =>
  isMap(v) && typeof v.name === "string" && v.name ? v.name : undefined;

function cleanEnvItem(v: unknown): unknown {
  if (!isMap(v)) return v;
  const copy = structuredClone(v);
  if (copy.value === null && "valueFrom" in copy) delete copy.value;
  return copy;
}

// mergeEnv merges over onto base by env var name: a matching name replaces the
// existing entry in place (preserving order, whether value or valueFrom), and a
// new name appends at the end.
export function mergeEnv(base: unknown[], over: unknown[]): unknown[] {
  const out: unknown[] = [];
  const byName = new Map<string, number>();
  const seen = new Set<string>();
  for (const item of [...base, ...over]) {
    const entry = cleanEnvItem(item);
    const name = envName(entry);
    if (name !== undefined) {
      const at = byName.get(name);
      if (at !== undefined) out[at] = entry;
      else {
        byName.set(name, out.length);
        out.push(entry);
      }
    } else {
      const c = canon(entry);
      if (!seen.has(c)) {
        seen.add(c);
        out.push(entry);
      }
    }
  }
  return out;
}

export function envBase(...trees: (Tree | undefined)[]): Tree {
  const out: Tree = {};
  for (const t of trees) {
    if (!isMap(t)) continue;
    if (Array.isArray(t.env)) {
      out.env = Array.isArray(out.env) ? mergeEnv(out.env, t.env) : mergeEnv([], t.env);
    }
    if (isMap(t.pd)) {
      for (const [role, rv] of Object.entries(t.pd)) {
        if (!isMap(rv) || !Array.isArray(rv.env)) continue;
        const pd = (isMap(out.pd) ? out.pd : (out.pd = {})) as Tree;
        const cur = (isMap(pd[role]) ? pd[role] : (pd[role] = {})) as Tree;
        cur.env = Array.isArray(cur.env) ? mergeEnv(cur.env, rv.env) : mergeEnv([], rv.env);
      }
    }
  }
  return out;
}

export function withEnv(base: Tree | undefined, layer: Tree): Tree {
  const b = envBase(base);
  let out = layer;
  if (Array.isArray(layer.env)) {
    out = { ...out, env: mergeEnv(Array.isArray(b.env) ? b.env : [], layer.env) };
  }
  if (isMap(layer.pd)) {
    const bpd = isMap(b.pd) ? b.pd : {};
    let pd: Tree | undefined;
    for (const [role, rv] of Object.entries(layer.pd)) {
      if (!isMap(rv) || !Array.isArray(rv.env)) continue;
      const br = isMap(bpd[role]) && Array.isArray(bpd[role].env) ? (bpd[role].env as unknown[]) : [];
      pd ??= { ...layer.pd };
      pd[role] = { ...rv, env: mergeEnv(br, rv.env) };
    }
    if (pd) out = { ...out, pd };
  }
  return out;
}

export function editsWithEnv(editsYAML: string, base: Tree | undefined): string {
  const trimmed = editsYAML.trim();
  if (!trimmed) return "";
  try {
    const doc = parseDocument(trimmed, { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length || !isYamlMap(doc.contents)) return trimmed;
    const parsed: unknown = doc.toJS({ maxAliasCount: 100 });
    if (!isMap(parsed)) return trimmed;
    const merged = withEnv(base, parsed);
    if (merged === parsed || canon(merged) === canon(parsed)) return trimmed;
    if (Array.isArray(merged.env)) doc.setIn(["env"], doc.createNode(merged.env));
    if (isMap(merged.pd)) {
      for (const [role, rv] of Object.entries(merged.pd)) {
        if (isMap(rv) && Array.isArray(rv.env)) doc.setIn(["pd", role, "env"], doc.createNode(rv.env));
      }
    }
    return doc.toString().trimEnd();
  } catch {
    return trimmed;
  }
}

export function presetValues(profile: SiteProfile | undefined, name: string): Tree | undefined {
  const extra = envBase(profile?.extra);
  const preset = name ? profile?.presets?.[name]?.values : undefined;
  if (!Object.keys(extra).length) return preset;
  return preset ? withPreset(structuredClone(preset), extra) : extra;
}

// withPreset puts the form's values over a preset's: maps merge, a list keeps
// the preset's items and adds the form's it lacks, and a scalar the form sets
// wins.
export function withPreset(overrides: Tree, preset: Tree | undefined): Tree {
  return preset ? merge(structuredClone(preset), overrides, true) : overrides;
}

// overlay is a release's form layer with the form's values over it, as an
// upgrade rebuilds it: maps merge, and a list or scalar the form sends
// replaces the release's.
export function overlay(layer: Tree, overrides: Tree): Tree {
  return merge(structuredClone(layer), overrides, false);
}

function merge(base: Tree, over: Tree, union: boolean, path = ""): Tree {
  for (const [k, v] of Object.entries(over)) {
    const p = path ? `${path}.${k}` : k;
    const b = base[k];
    if (isMap(b) && isMap(v)) {
      merge(b, v, union, p);
    } else if (Array.isArray(b) && Array.isArray(v) && isEnvPath(p)) {
      base[k] = mergeEnv(b, v);
    } else if (union && Array.isArray(b) && Array.isArray(v)) {
      const seen = new Set(b.map(canon));
      for (const item of v) {
        const c = canon(item);
        if (!seen.has(c)) {
          seen.add(c);
          b.push(item);
        }
      }
    } else {
      base[k] = v;
    }
  }
  return base;
}
