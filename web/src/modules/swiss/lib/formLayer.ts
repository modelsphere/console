import type { SiteProfile } from "@swiss/lib/api";

type Tree = Record<string, unknown>;

export const isMap = (v: unknown): v is Tree => !!v && typeof v === "object" && !Array.isArray(v);

// Key order does not make two list items different.
const canon = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (isMap(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export function presetValues(profile: SiteProfile | undefined, name: string): Tree | undefined {
  return name ? profile?.presets?.[name]?.values : undefined;
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
