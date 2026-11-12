import { isMap as isYamlMap, parseDocument } from "yaml";
import type { SiteProfile } from "@swiss/lib/api";

type Tree = Record<string, unknown>;

export const isMap = (v: unknown): v is Tree => !!v && typeof v === "object" && !Array.isArray(v);

// Key order does not make two list items different.
const canon = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (isMap(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// mergeEnv merges over onto base by env var name: a matching name replaces the
// existing entry in place (preserving order, whether value or valueFrom), and a
// new name appends at the end. Note: because entries merge by name, a catalog
// or site extra env var can be overridden in place by form/edit layers but not
// deleted from the list.
export function mergeEnv(base: unknown[], over: unknown[]): unknown[] {
  const out: unknown[] = [];
  const byName = new Map<string, number>();
  for (const item of [...base, ...over]) {
    const name = isMap(item) && typeof item.name === "string" ? item.name : "";
    const at = name ? byName.get(name) : undefined;
    if (at !== undefined) out[at] = item;
    else {
      if (name) byName.set(name, out.length);
      out.push(item);
    }
  }
  return out;
}

export function envBase(...trees: (Tree | undefined)[]): Tree {
  const out: Tree = {};
  for (const t of trees) {
    if (!isMap(t)) continue;
    if (Array.isArray(t.env)) {
      out.env = mergeEnv(Array.isArray(out.env) ? out.env : [], t.env);
    }
    if (isMap(t.pd)) {
      for (const [role, rv] of Object.entries(t.pd)) {
        if (!isMap(rv) || !Array.isArray(rv.env)) continue;
        const pd = (isMap(out.pd) ? out.pd : (out.pd = {})) as Tree;
        const cur = (isMap(pd[role]) ? pd[role] : (pd[role] = {})) as Tree;
        cur.env = mergeEnv(Array.isArray(cur.env) ? cur.env : [], rv.env);
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
    if (doc.errors.length || !isYamlMap(doc.contents)) return trimmed;
    const parsed = doc.toJS() as Tree;
    const merged = withEnv(base, parsed);
    if (merged === parsed) return trimmed;
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
  return name ? profile?.presets?.[name]?.values : undefined;
}

// withPreset puts the form's values over a preset's: maps merge, a list keeps
// the preset's items and adds the form's it lacks, and a scalar the form sets
// wins.
export function withPreset(overrides: Tree, preset: Tree | undefined): Tree {
  return preset ? withEnv(preset, merge(structuredClone(preset), overrides, true)) : overrides;
}

// overlay is a release's form layer with the form's values over it, as an
// upgrade rebuilds it: maps merge, and a list or scalar the form sends
// replaces the release's.
export function overlay(layer: Tree, overrides: Tree): Tree {
  return merge(structuredClone(layer), overrides, false);
}

function merge(base: Tree, over: Tree, union: boolean): Tree {
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    if (isMap(b) && isMap(v)) {
      merge(b, v, union);
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
