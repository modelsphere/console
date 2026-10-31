import yaml from "js-yaml";
import type { Json, JsonObject } from "../types";
import { isObject } from "./values";

export function toYaml(value: unknown): string {
  return (
    yaml
      .dump(value, {
        lineWidth: 120,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      })
      .trimEnd() + "\n"
  );
}

/**
 * Parse a YAML document that must be one plain JSON object.
 *
 * js-yaml resolves anchors and aliases into shared JS references; a
 * self-referential anchor therefore produces a cyclic object. `toYaml`
 * serialises with `noRefs`, so a cycle would recurse until the stack
 * overflows — and the draft is re-serialised on every keystroke. The tree is
 * copied into JSON here, which rejects cycles and values JSON cannot carry.
 *
 * JSON_SCHEMA keeps timestamps as strings and leaves YAML 1.1 booleans such as
 * `on` / `yes` alone, matching what chart values can hold.
 *
 * A document with no content (empty, comments only, or `null`) means "no
 * overrides" and returns undefined.
 */
export function fromYamlObject(
  text: string,
  invalidMessage = "YAML must be an object with named keys.",
): JsonObject | undefined {
  const loaded: unknown = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (loaded === undefined || loaded === null) return undefined;
  const seen = new Set<object>();
  const visit = (node: unknown, path: string): Json => {
    if (node === null || typeof node === "string" || typeof node === "boolean") {
      return node;
    }
    if (typeof node === "number") {
      if (!Number.isFinite(node)) {
        throw new Error(`${invalidMessage} (${path || "document"})`);
      }
      return node;
    }
    if (typeof node !== "object") {
      throw new Error(`${invalidMessage} (${path || "document"})`);
    }
    if (seen.has(node)) {
      throw new Error(
        `${invalidMessage} (${path || "document"}: recursive alias)`,
      );
    }
    seen.add(node);
    let out: Json;
    if (Array.isArray(node)) {
      out = node.map((item, index) => visit(item, `${path}[${index}]`));
    } else if (isObject(node)) {
      const record: JsonObject = {};
      for (const [key, child] of Object.entries(node)) {
        record[key] = visit(child, path ? `${path}.${key}` : key);
      }
      out = record;
    } else {
      throw new Error(`${invalidMessage} (${path || "document"})`);
    }
    seen.delete(node);
    return out;
  };
  const parsed = visit(loaded, "");
  if (!isObject(parsed)) throw new Error(invalidMessage);
  return parsed;
}
