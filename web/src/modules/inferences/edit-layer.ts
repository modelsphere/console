import { parse, stringify } from "yaml";

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target: Tree, source: Tree): Tree {
  const out: Tree = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isTree(value) && isTree(out[key])) {
      out[key] = deepMerge(out[key] as Tree, value);
    } else if (isTree(value)) {
      out[key] = deepMerge({}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Ensures extension-required keys (such as an inherited modelRoute.slo) stay
 * present in the final `edit` layer when composing upgrade plans.
 */
export function mergeEditLayerYAML(editsYAML: string | undefined, editLayer: Record<string, unknown> | undefined): string | undefined {
  if (!editLayer || Object.keys(editLayer).length === 0) {
    return editsYAML?.trim() ? editsYAML : undefined;
  }
  let base: Tree = {};
  if (editsYAML && editsYAML.trim() !== "") {
    const parsed = parse(editsYAML);
    if (parsed !== null && parsed !== undefined) {
      if (!isTree(parsed)) {
        throw new Error("edits YAML must be a mapping");
      }
      base = parsed;
    }
  }
  return stringify(deepMerge(base, editLayer)).trim();
}
