import { parse, stringify } from "yaml";
import { isMap } from "@swiss/lib/formLayer";

type Tree = Record<string, unknown>;

const REQUIRED_NODE = "nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution";
const LISTS = [
  `${REQUIRED_NODE}.nodeSelectorTerms`,
  "nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution",
  "podAffinity.requiredDuringSchedulingIgnoredDuringExecution",
  "podAffinity.preferredDuringSchedulingIgnoredDuringExecution",
  "podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution",
  "podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution",
];

// The GPU product label, under whichever vendor's key.
export const PRODUCT_KEY = /\.product$|device-id$|ascend910$/i;

export interface AffinityRule {
  // "affinity", or a PD role's "pd.<role>.affinityReplace".
  scope: string;
  // The list in it the rule is an item of.
  list: string;
  rule: unknown;
  // The rule as typed, and why it does not parse.
  text: string;
  error?: string;
  // Removed on this upgrade.
  drop?: boolean;
}

const at = (v: unknown, path: string) => path.split(".").reduce<unknown>((acc, k) => (isMap(acc) ? acc[k] : undefined), v);

// affinityRules lists every rule a form layer's affinities carry, in order.
export function affinityRules(layer: Tree): AffinityRule[] {
  const scopes: [string, unknown][] = [["affinity", layer.affinity]];
  if (isMap(layer.pd)) {
    for (const [role, cfg] of Object.entries(layer.pd)) {
      if (isMap(cfg)) scopes.push([`pd.${role}.affinityReplace`, cfg.affinityReplace]);
    }
  }
  return scopes.flatMap(([scope, aff]) =>
    LISTS.flatMap((list) => {
      const items = at(aff, list);
      return Array.isArray(items) ? items.map((rule) => ({ scope, list, rule, text: stringify(rule) })) : [];
    }),
  );
}

export function editRule(r: AffinityRule, text: string): AffinityRule {
  try {
    const rule: unknown = parse(text);
    return isMap(rule) ? { ...r, text, rule, error: undefined } : { ...r, text, error: "not a map" };
  } catch (e) {
    return { ...r, text, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

export const affinityInvalid = (rules: AffinityRule[]) => rules.some((r) => r.error && !r.drop);

// "nodeAffinity.required", for a rule's heading.
export const listLabel = (list: string) => list.replace("DuringSchedulingIgnoredDuringExecution", "").replace(".nodeSelectorTerms", "");

function set(t: Tree, path: string, value: unknown) {
  const segs = path.split(".");
  let cur = t;
  for (const s of segs.slice(0, -1)) {
    if (!isMap(cur[s])) cur[s] = {};
    cur = cur[s] as Tree;
  }
  cur[segs[segs.length - 1]] = value;
}

// setAffinity writes each list back as its rules now stand. swissd merges an
// upgrade over the release's form layer, where a list replaces but a map key
// left out stays: so a list emptied of rules cannot always go as []. A role's
// affinityReplace with no rule left goes to null, which the chart reads as
// inherit, and empty nodeSelectorTerms, which Kubernetes refuses, take their
// required block to null. Products picked mean swissd writes the top-level
// terms itself.
export function setAffinity(overrides: Tree, rules: AffinityRule[], gpuPicked: boolean) {
  for (const scope of new Set(rules.map((r) => r.scope))) {
    const mine = rules.filter((r) => r.scope === scope);
    if (scope !== "affinity" && mine.every((r) => r.drop)) {
      set(overrides, scope, null);
      continue;
    }
    for (const list of new Set(mine.map((r) => r.list))) {
      const kept = mine.filter((r) => r.list === list && !r.drop).map((r) => r.rule);
      if (kept.length > 0) set(overrides, `${scope}.${list}`, kept);
      else if (list !== LISTS[0]) set(overrides, `${scope}.${list}`, []);
      else if (!(scope === "affinity" && gpuPicked)) set(overrides, `${scope}.${REQUIRED_NODE}`, null);
    }
  }
}
