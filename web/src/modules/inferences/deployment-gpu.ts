import { layersOf } from "@swiss/components/Provenance";
import type { GPUSpec, Plan } from "@swiss/lib/api";
import type { Form } from "@swiss/components/DeploySettings";
import { editDraftValues } from "./deployment-draft";
import { mergeValues, parseValues, type Values } from "./override-yaml";

const TERMS = ["affinity", "nodeAffinity", "requiredDuringSchedulingIgnoredDuringExecution", "nodeSelectorTerms"];

function at(values: Values, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Values)[key] : undefined, values);
}

function selector(terms: unknown): Values {
  return { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: terms === null ? null : { nodeSelectorTerms: terms } } } };
}

function gpuKeys(specifications: GPUSpec[], generated: Values[]): Set<string> {
  const keys = specifications.map((entry) => entry.labelKey);
  for (const term of generated) {
    if (!Array.isArray(term.matchExpressions)) continue;
    for (const expression of term.matchExpressions) if (typeof expression?.key === "string") keys.push(expression.key);
  }
  return new Set(keys);
}

function intersectTerms(previous: Values, generated: Values): Values {
  const combined = { ...previous, ...generated };
  for (const key of ["matchExpressions", "matchFields"]) {
    const entries = [...(Array.isArray(previous[key]) ? previous[key] : []), ...(Array.isArray(generated[key]) ? generated[key] : [])];
    if (entries.length) combined[key] = entries;
    else delete combined[key];
  }
  return combined;
}

function rewriteTerms(previous: unknown, generated: unknown, specifications: GPUSpec[]): Values[] | null {
  if (previous != null && !Array.isArray(previous)) throw new Error("Required node affinity must contain a list of selector terms.");
  const current: Values[] = previous ?? [];
  if (current.some((term) => !term || typeof term !== "object" || Array.isArray(term))) throw new Error("Required node affinity contains an invalid selector term.");
  if (current.some((term) => ["matchExpressions", "matchFields"].some((key) => term[key] !== undefined && !Array.isArray(term[key])))) throw new Error("Required node affinity contains an invalid selector expression list.");
  const next: Values[] = Array.isArray(generated) ? generated : [];
  const keys = gpuKeys(specifications, next);
  const isGpu = (expression: Values) => expression && typeof expression.key === "string" && keys.has(expression.key);
  // Replace GPU expressions within their original OR branches, retaining other required constraints.
  const hasGpu = current.some((term) => Array.isArray(term.matchExpressions) && term.matchExpressions.some(isGpu));
  const updated = current.flatMap((term) => {
    const expressions = Array.isArray(term.matchExpressions) ? term.matchExpressions : [];
    const owned = expressions.some(isGpu);
    if (!owned) return !hasGpu && next.length ? next.map((generatedTerm) => intersectTerms(term, generatedTerm)) : [term];
    const retained = { ...term };
    const others = expressions.filter((expression) => !isGpu(expression));
    if (others.length) retained.matchExpressions = others;
    else delete retained.matchExpressions;
    if (next.length) return next.map((generatedTerm) => intersectTerms(retained, generatedTerm));
    return Object.keys(retained).length ? [retained] : [];
  });
  return (current.length ? updated : next).length ? (current.length ? updated : next) : null;
}

export function gpuResolutionValues(text: string, specifications: GPUSpec[] = []): Values {
  const previous = parseValues(text);
  const terms = rewriteTerms(at(previous, TERMS), null, specifications);
  return parseValues(editDraftValues(text, { ...selector(terms), model: { gpuResource: null } }, previous));
}

export function resolvedGpuChanges(plan: Plan, form: Form, specifications: GPUSpec[] = [], defaults: Values = {}, effective?: Values): Values {
  const target = layersOf(plan).filter((key) => !["form", "edit", "autoscale", "canary-system"].includes(key)).reduce((values, key) => mergeValues(values, plan.layers[key]), defaults);
  const terms = at(form.gpuProducts.length ? plan.layers.form ?? {} : target, TERMS) ?? null;
  if (form.gpuProducts.length && !Array.isArray(terms)) throw new Error("The deployment service did not resolve the selected GPU products.");
  const previous = parseValues(form.edits);
  const resource = form.gpuResource || at(effective ?? target, ["model", "gpuResource"]);
  if (resource !== undefined && (typeof resource !== "string" || !resource)) throw new Error("The deployment service returned an invalid GPU resource.");
  return { ...selector(rewriteTerms(at(previous, TERMS), terms, specifications)), model: { gpuResource: resource ?? null } };
}

export function applyResolvedGpu(text: string, changes: Values): string {
  const withoutResource = editDraftValues(text, { model: changes.model }, parseValues(text));
  // A cleared selector must mask the retained form layer rather than reveal the old selection.
  return editDraftValues(withoutResource, { affinity: changes.affinity }, {}, "retain");
}

export function configuredGpuProducts(values: Values, specifications: GPUSpec[], fallback: string[]): string[] {
  const terms = at(values, TERMS);
  if (!Array.isArray(terms)) return [];
  const selected = new Set<string>();
  for (const term of terms) {
    const expressions = term && typeof term === "object" ? term.matchExpressions : undefined;
    if (!Array.isArray(expressions)) continue;
    for (const expression of expressions) {
      const specification = specifications.find((entry) => entry.labelKey === expression?.key);
      if (!specification || expression.operator !== "In" || !Array.isArray(expression.values)) continue;
      const labels: unknown[] = expression.values;
      const products = labels.filter((value): value is string => typeof value === "string").map((value) => specification.products?.find((product) => product.product === value || product.values?.includes(value))?.product ?? value);
      for (const product of products) selected.add(product);
    }
  }
  return selected.size ? [...selected] : fallback;
}
