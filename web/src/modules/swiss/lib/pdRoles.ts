import { PRODUCT_KEY, affinityRules, type AffinityRule } from "@swiss/lib/affinity";
import type { GPUSpec, HelmValues, Node, Plan } from "@swiss/lib/api";
import { isMap, overlay } from "@swiss/lib/formLayer";
import { gpuCapacity, vendorResources, type GPUCapacity } from "@swiss/lib/gpu";
import { mergedHelmValues } from "@swiss/lib/imageSlots";

export type PdRole = "prefill" | "decode";
export const PD_ROLES: readonly PdRole[] = ["prefill", "decode"];

type Tree = Record<string, unknown>;

export interface PdRoleInfo {
  role: PdRole;
  // GPUs requested per pod of this role (pd.<role>.gpus if set, else model.gpus).
  gpus: number;
  replicas: number;
  size: number;
  // True when dry-run helmValues already carries a non-null affinityReplace.
  hasAffinityReplace: boolean;
  // Canonical GPU products found in dry-run pd.<role>.affinityReplace, if any.
  gpuProducts: string[];
}

export interface PdInfo {
  enabled: boolean;
  colocate: boolean;
  prefill?: PdRoleInfo;
  decode?: PdRoleInfo;
}

export interface PdRoleOverride {
  gpuProducts: string[];
}

export type PdOverrides = Record<PdRole, PdRoleOverride>;

export function emptyPdOverrides(): PdOverrides {
  return {
    prefill: { gpuProducts: [] },
    decode: { gpuProducts: [] },
  };
}

function readNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function dedupe(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    if (x && !out.includes(x)) out.push(x);
  }
  return out;
}

export function gpuLabelKeys(gpuSpecs?: GPUSpec[]): Set<string> {
  const keys = new Set<string>();
  for (const g of gpuSpecs ?? []) {
    if (g.labelKey) keys.add(g.labelKey);
  }
  return keys;
}

// Resolve canonical GPUSpec.products names from raw affinity label values
// (reverse-mapping any GPUSpec.products[].values aliases like Ascend910B4-1 -> Ascend-910B4).
export function canonicalizeProducts(values: string[], gpuSpecs?: GPUSpec[]): string[] {
  if (!gpuSpecs?.length) return dedupe(values);
  const aliasToProduct = new Map<string, string>();
  for (const spec of gpuSpecs) {
    for (const p of spec.products ?? []) {
      aliasToProduct.set(p.product, p.product);
      for (const alias of p.values ?? []) {
        if (!aliasToProduct.has(alias)) aliasToProduct.set(alias, p.product);
      }
    }
  }
  return dedupe(values.map((v) => aliasToProduct.get(v) ?? v));
}

function expandProductValues(products: string[], spec?: GPUSpec): string[] {
  const out: string[] = [];
  for (const p of products) {
    if (!p) continue;
    if (!out.includes(p)) out.push(p);
    const entry = spec?.products?.find((x) => x.product === p);
    for (const v of entry?.values ?? []) {
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

export function gpuSpecForRole(gpuSpecs?: GPUSpec[], gpuResource?: string, vendor?: string): GPUSpec | undefined {
  if (!gpuSpecs?.length) return undefined;
  if (gpuResource) return gpuSpecs.find((g) => g.resource === gpuResource);
  const defRes = vendorResources(gpuSpecs, vendor)[0];
  return defRes ? gpuSpecs.find((g) => g.resource === defRes) : undefined;
}

export function isGpuProductExpr(
  expr: unknown,
  labelKeys?: Set<string>,
): expr is { key: string; operator: "In"; values: string[] } {
  if (!isMap(expr)) return false;
  if (typeof expr.key !== "string" || !expr.key) return false;
  if (!labelKeys?.has(expr.key) && !PRODUCT_KEY.test(expr.key)) return false;
  return expr.operator === "In" && Array.isArray(expr.values);
}

export function isStandaloneGpuProductTerm(term: unknown, labelKeys?: Set<string>): boolean {
  if (!isMap(term)) return false;
  if (Array.isArray(term.matchFields) && term.matchFields.length > 0) return false;
  if (!Array.isArray(term.matchExpressions) || term.matchExpressions.length !== 1) return false;
  return isGpuProductExpr(term.matchExpressions[0], labelKeys);
}

const REQUIRED_NODE_PATH = ["nodeAffinity", "requiredDuringSchedulingIgnoredDuringExecution"] as const;

function nodeSelectorTermsOf(affinity: unknown): unknown[] | undefined {
  if (!isMap(affinity)) return undefined;
  const na = affinity[REQUIRED_NODE_PATH[0]];
  if (!isMap(na)) return undefined;
  const req = na[REQUIRED_NODE_PATH[1]];
  if (!isMap(req) || !Array.isArray(req.nodeSelectorTerms)) return undefined;
  return req.nodeSelectorTerms;
}

// One walk: products from any GPU matchExpression, and the label key plus
// products of a term whose only expression is that GPU product.
function readGpuAffinity(
  affinityReplace: unknown,
  gpuSpecs?: GPUSpec[],
): { key?: string; standalone: string[]; any: string[] } {
  const terms = nodeSelectorTermsOf(affinityReplace);
  if (!terms) return { standalone: [], any: [] };
  const keys = gpuLabelKeys(gpuSpecs);
  let key: string | undefined;
  const standaloneVals: string[] = [];
  const anyVals: string[] = [];
  for (const term of terms) {
    if (!isMap(term) || !Array.isArray(term.matchExpressions)) continue;
    const standalone = isStandaloneGpuProductTerm(term, keys);
    for (const expr of term.matchExpressions) {
      if (!isGpuProductExpr(expr, keys)) continue;
      if (standalone) key ??= expr.key;
      for (const v of expr.values) {
        if (typeof v !== "string") continue;
        anyVals.push(v);
        if (standalone) standaloneVals.push(v);
      }
    }
  }
  return {
    key,
    standalone: canonicalizeProducts(standaloneVals, gpuSpecs),
    any: canonicalizeProducts(anyVals, gpuSpecs),
  };
}

export function extractPdInfo(helmValues: unknown, gpuSpecs?: GPUSpec[]): PdInfo | undefined {
  if (!isMap(helmValues) || !isMap(helmValues.pd) || helmValues.pd.enabled !== true) {
    return undefined;
  }
  const pd = helmValues.pd;
  const colocate = pd.colocate === true;
  const modelGpus = isMap(helmValues.model) ? readNumber(helmValues.model.gpus) : undefined;

  const readRole = (role: PdRole): PdRoleInfo => {
    const raw = isMap(pd[role]) ? pd[role] : {};
    const gpus = readNumber(raw.gpus) ?? modelGpus ?? 0;
    const replicas = readNumber(raw.replicas) ?? 1;
    const size = readNumber(raw.size) ?? 1;
    const hasAffinityReplace = isMap(raw.affinityReplace);
    const gpuProducts = hasAffinityReplace ? readGpuAffinity(raw.affinityReplace, gpuSpecs).any : [];
    return {
      role,
      gpus,
      replicas,
      size,
      hasAffinityReplace,
      gpuProducts,
    };
  };

  return {
    enabled: true,
    colocate,
    prefill: readRole("prefill"),
    decode: readRole("decode"),
  };
}

export function helmPdInfo(
  values: Pick<HelmValues, "defaults" | "overrides">,
  gpuSpecs?: GPUSpec[],
): PdInfo | undefined {
  return extractPdInfo(mergedHelmValues(values), gpuSpecs);
}

const PLAN_LAYER_ORDER = ["defaults", "catalog", "site", "form", "derived", "edit"] as const;

export function planPdInfo(
  layers: Plan["layers"] | undefined,
  gpuSpecs?: GPUSpec[],
): PdInfo | undefined {
  if (!layers) return undefined;
  let merged: Tree = {};
  for (const name of PLAN_LAYER_ORDER) {
    const l = layers[name];
    if (isMap(l)) merged = overlay(merged, l);
  }
  return extractPdInfo(merged, gpuSpecs);
}

// Form seeding excludes standalone pd.<role>.affinityReplace GPU product terms from
// the generic AffinityRules YAML editor so the role GPU product chips own them
// cleanly without duplicating them as raw YAML boxes.
export function affinityRulesForForm(layer: Tree, gpuSpecs?: GPUSpec[]): AffinityRule[] {
  const keys = gpuLabelKeys(gpuSpecs);
  return affinityRules(layer).filter(
    (r) => !(r.scope.startsWith("pd.") && r.list.includes("required") && isStandaloneGpuProductTerm(r.rule, keys)),
  );
}

export function pdFromLayer(layer: Tree, gpuSpecs?: GPUSpec[]): PdOverrides {
  const out = emptyPdOverrides();
  const pd = isMap(layer.pd) ? layer.pd : undefined;
  if (!pd) return out;
  for (const role of PD_ROLES) {
    const cfg = isMap(pd[role]) ? pd[role] : undefined;
    if (!cfg) continue;
    out[role] = { gpuProducts: readGpuAffinity(cfg.affinityReplace, gpuSpecs).standalone };
  }
  return out;
}

function ensureRoleAffinityRequiredTerms(roleCfg: Tree): unknown[] {
  const aff = (isMap(roleCfg.affinityReplace) ? roleCfg.affinityReplace : (roleCfg.affinityReplace = {})) as Tree;
  const na = (isMap(aff.nodeAffinity) ? aff.nodeAffinity : (aff.nodeAffinity = {})) as Tree;
  const req = (isMap(na[REQUIRED_NODE_PATH[1]])
    ? na[REQUIRED_NODE_PATH[1]]
    : (na[REQUIRED_NODE_PATH[1]] = {})) as Tree;
  if (!Array.isArray(req.nodeSelectorTerms)) req.nodeSelectorTerms = [];
  return req.nodeSelectorTerms as unknown[];
}

function writeRoleGpuTerm(layer: Tree, role: PdRole, labelKey: string, values: string[], labelKeys: Set<string>) {
  const pdTarget = (isMap(layer.pd) ? layer.pd : (layer.pd = {})) as Tree;
  const roleTarget = (isMap(pdTarget[role]) ? pdTarget[role] : (pdTarget[role] = {})) as Tree;
  const terms = ensureRoleAffinityRequiredTerms(roleTarget);
  const kept = terms.filter((t) => !isStandaloneGpuProductTerm(t, labelKeys));
  kept.push({ matchExpressions: [{ key: labelKey, operator: "In", values }] });
  const na = (roleTarget.affinityReplace as Tree).nodeAffinity as Tree;
  (na[REQUIRED_NODE_PATH[1]] as Tree).nodeSelectorTerms = kept;
}

// Drops the role's standalone GPU product term. An empty required list is
// removed with it: empty nodeSelectorTerms matches no node. Other affinity
// keys and other pd.<role> keys are left in place. Nothing is set to null.
function clearRoleGpuTerm(layer: Tree, role: PdRole, labelKeys: Set<string>) {
  const pdMap = isMap(layer.pd) ? layer.pd : undefined;
  const roleMap = pdMap && isMap(pdMap[role]) ? pdMap[role] : undefined;
  if (!roleMap || !isMap(roleMap.affinityReplace)) return;
  const aff = roleMap.affinityReplace;
  const terms = nodeSelectorTermsOf(aff);
  if (!terms) return;
  const kept = terms.filter((t) => !isStandaloneGpuProductTerm(t, labelKeys));
  if (kept.length === terms.length) return;
  const na = isMap(aff.nodeAffinity) ? aff.nodeAffinity : undefined;
  if (!na || !isMap(na[REQUIRED_NODE_PATH[1]])) return;
  if (kept.length > 0) {
    (na[REQUIRED_NODE_PATH[1]] as Tree).nodeSelectorTerms = kept;
    return;
  }
  delete na[REQUIRED_NODE_PATH[1]];
  if (Object.keys(na).length === 0) delete aff.nodeAffinity;
  if (Object.keys(aff).length === 0) delete roleMap.affinityReplace;
}

function formRoleGpu(
  formLayer: Tree | undefined,
  role: PdRole,
  gpuSpecs?: GPUSpec[],
): { key?: string; standalone: string[]; any: string[] } {
  const pd = isMap(formLayer?.pd) ? formLayer.pd : undefined;
  const roleCfg = pd && isMap(pd[role]) ? pd[role] : undefined;
  return roleCfg ? readGpuAffinity(roleCfg.affinityReplace, gpuSpecs) : { standalone: [], any: [] };
}

// Writes the one pd.<role> GPU product term from the role chips. Clearing
// removes that term when the form layer owned it. replicas, extraArgs,
// schedulerName, and any other role keys stay as they are.
export function applyPdOverrides(
  layer: Tree,
  pd: PdOverrides,
  opts: {
    gpuSpecs?: GPUSpec[];
    gpuResource?: string;
    gpuVendor?: string;
    formLayer?: Tree;
  } = {},
): void {
  const labelKeys = gpuLabelKeys(opts.gpuSpecs);
  const spec = gpuSpecForRole(opts.gpuSpecs, opts.gpuResource, opts.gpuVendor);

  for (const role of PD_ROLES) {
    const products = canonicalizeProducts(pd[role].gpuProducts, opts.gpuSpecs);
    const prev = formRoleGpu(opts.formLayer, role, opts.gpuSpecs);
    // setAffinity rebuilds the role list without this term (the chips own it).
    // The spec's labelKey is how a new term is addressed; the form layer's key
    // covers an upgrade whose profile was not passed in.
    const labelKey = spec?.labelKey || prev.key;
    if (products.length > 0 && labelKey) {
      const values = spec?.labelKey ? expandProductValues(products, spec) : dedupe(products);
      writeRoleGpuTerm(layer, role, labelKey, values, labelKeys);
    } else if (products.length === 0 && prev.standalone.length > 0) {
      clearRoleGpuTerm(layer, role, labelKeys);
    }

    if (isMap(layer.pd) && isMap(layer.pd[role]) && Object.keys(layer.pd[role]).length === 0) {
      delete layer.pd[role];
    }
    if (isMap(layer.pd) && Object.keys(layer.pd).length === 0) {
      delete layer.pd;
    }
  }
}

export function pdRoleCapacity(
  roleInfo: PdRoleInfo | undefined,
  edit: PdRoleOverride,
  opts: {
    nodes?: Node[];
    gpuSpecs?: GPUSpec[];
    gpuVendor?: string;
    gpuResource?: string;
    topGpuProducts?: string[];
    supportedGpus?: string[];
  },
): { value?: GPUCapacity; perPod: number; needNodes: number } | undefined {
  if (!roleInfo || roleInfo.gpus <= 0) return undefined;
  const products =
    edit.gpuProducts.length > 0
      ? canonicalizeProducts(edit.gpuProducts, opts.gpuSpecs)
      : roleInfo.gpuProducts.length > 0
        ? roleInfo.gpuProducts
        : opts.topGpuProducts?.length
          ? opts.topGpuProducts
          : opts.supportedGpus;
  const value = gpuCapacity(
    opts.nodes,
    {
      vendor: opts.gpuVendor,
      resource: opts.gpuResource || undefined,
      products: products?.length ? products : undefined,
      perPod: roleInfo.gpus,
    },
    opts.gpuSpecs,
  );
  return {
    value,
    perPod: roleInfo.gpus,
    needNodes: roleInfo.size,
  };
}
