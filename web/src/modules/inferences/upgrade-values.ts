import { isScalar, parseDocument, stringify, visit } from "yaml";

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => value !== null && typeof value === "object" && !Array.isArray(value);

export class UpgradeValuesError extends Error {
  constructor(public code: "yaml" | "mapping" | "unsupported" | "tooLarge" | "missing" | "changed" | "unavailable") {
    super(code);
  }
}

function readValues(text: string): Tree {
  if (text.length > 1 << 20) throw new UpgradeValuesError("tooLarge");
  const document = parseDocument(text, { intAsBigInt: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new UpgradeValuesError("yaml");
  visit(document, { Pair(_, pair) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new UpgradeValuesError("mapping");
  } });
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 50 });
  } catch {
    throw new UpgradeValuesError("unsupported");
  }
  if (!isTree(value)) throw new UpgradeValuesError("mapping");
  let nodes = 0;
  const ancestors = new Set<object>();
  const validate = (item: unknown, depth: number) => {
    if (++nodes > 50_000 || depth > 64) throw new UpgradeValuesError("tooLarge");
    if (typeof item === "number" && !Number.isFinite(item)) throw new UpgradeValuesError("unsupported");
    if (item !== null && typeof item === "object") {
      if (ancestors.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new UpgradeValuesError("unsupported");
      ancestors.add(item);
      for (const child of Object.values(item)) validate(child, depth + 1);
      ancestors.delete(item);
    }
  };
  validate(value, 0);
  return value;
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!isTree(a) || !isTree(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

function changedValues(before: Tree, after: Tree): Tree {
  const changed: Tree = Object.create(null);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) changed[key] = null;
    else if (!Object.hasOwn(before, key)) changed[key] = after[key];
    else if (!equal(before[key], after[key])) {
      changed[key] = isTree(before[key]) && isTree(after[key]) ? changedValues(before[key], after[key]) : after[key];
    }
  }
  return changed;
}

function mergeValues(before: Tree, patch: Tree): Tree {
  const result: Tree = Object.assign(Object.create(null), before);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isTree(result[key]) && isTree(value) ? mergeValues(result[key], value) : value;
  }
  return result;
}

export function upgradeEditsYAML(baseline: string, edited: string, previousEdits: Tree = {}): string {
  const changes = changedValues(readValues(baseline), readValues(edited));
  return stringify(mergeValues(previousEdits, changes), { lineWidth: 0 });
}
