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

function parseNonNegNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function parsePosInt(v: unknown): number | undefined {
  const n = parseNonNegNumber(v);
  return n !== undefined && n >= 1 ? Math.floor(n) : undefined;
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

export function expandProductValues(products: string[], spec?: GPUSpec): string[] {
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
const PREFERRED_NODE_KEY = "preferredDuringSchedulingIgnoredDuringExecution";

function nodeSelectorTermsOf(affinity: unknown): unknown[] | undefined {
  if (!isMap(affinity)) return undefined;
  const na = affinity[REQUIRED_NODE_PATH[0]];
  if (!isMap(na)) return undefined;
  const req = na[REQUIRED_NODE_PATH[1]];
  if (!isMap(req) || !Array.isArray(req.nodeSelectorTerms)) return undefined;
  return req.nodeSelectorTerms;
}

function extractStandaloneGpuTerm(
  affinityReplace: unknown,
  gpuSpecs?: GPUSpec[],
): { key?: string; products: string[] } {
  const terms = nodeSelectorTermsOf(affinityReplace);
  if (!terms) return { products: [] };
  const keys = gpuLabelKeys(gpuSpecs);
  let key: string | undefined;
  const rawVals: string[] = [];
  for (const t of terms) {
    if (!isStandaloneGpuProductTerm(t, keys)) continue;
    const expr = (t as { matchExpressions: { key: string; values: unknown[] }[] }).matchExpressions[0];
    key ??= expr.key;
    for (const v of expr.values) {
      if (typeof v === "string") rawVals.push(v);
    }
  }
  return { key, products: canonicalizeProducts(rawVals, gpuSpecs) };
}

function extractAnyGpuProducts(affinityReplace: unknown, gpuSpecs?: GPUSpec[]): string[] {
  const terms = nodeSelectorTermsOf(affinityReplace);
  if (!terms) return [];
  const keys = gpuLabelKeys(gpuSpecs);
  const rawVals: string[] = [];
  for (const t of terms) {
    if (!isMap(t) || !Array.isArray(t.matchExpressions)) continue;
    for (const expr of t.matchExpressions) {
      if (!isGpuProductExpr(expr, keys)) continue;
      for (const v of expr.values) {
        if (typeof v === "string") rawVals.push(v);
      }
    }
  }
  return canonicalizeProducts(rawVals, gpuSpecs);
}

export function extractPdInfo(helmValues: unknown, gpuSpecs?: GPUSpec[]): PdInfo | undefined {
  if (!isMap(helmValues) || !isMap(helmValues.pd) || helmValues.pd.enabled !== true) {
    return undefined;
  }
  const pd = helmValues.pd;
  const colocate = pd.colocate === true;
  const modelGpus = isMap(helmValues.model) ? parseNonNegNumber(helmValues.model.gpus) : undefined;

  const readRole = (role: PdRole): PdRoleInfo => {
    const raw = isMap(pd[role]) ? pd[role] : {};
    const gpus = parseNonNegNumber(raw.gpus) ?? modelGpus ?? 0;
    const replicas = parsePosInt(raw.replicas) ?? 1;
    const size = parsePosInt(raw.size) ?? 1;
    const hasAffinityReplace = isMap(raw.affinityReplace);
    const gpuProducts = hasAffinityReplace ? extractAnyGpuProducts(raw.affinityReplace, gpuSpecs) : [];
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
    const { products } = extractStandaloneGpuTerm(cfg.affinityReplace, gpuSpecs);
    out[role] = { gpuProducts: products };
  }
  return out;
}

function hasAnyAffinityRule(affinityReplace: Tree): boolean {
  if (isMap(affinityReplace.podAffinity) && Object.keys(affinityReplace.podAffinity).length > 0) return true;
  if (isMap(affinityReplace.podAntiAffinity) && Object.keys(affinityReplace.podAntiAffinity).length > 0) return true;
  if (!isMap(affinityReplace.nodeAffinity)) return false;
  const na = affinityReplace.nodeAffinity;
  if (Array.isArray(na[PREFERRED_NODE_KEY]) && na[PREFERRED_NODE_KEY].length > 0) return true;
  const req = na[REQUIRED_NODE_PATH[1]];
  if (isMap(req) && Array.isArray(req.nodeSelectorTerms) && req.nodeSelectorTerms.length > 0) return true;
  return false;
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

// applyPdOverrides reconciles pd.<role>.affinityReplace after base overlay,
// preset merge, and generic setAffinity have run. Any other pd.<role> keys
// (such as replicas, extraArgs, schedulerName) remain carried untouched on base.
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
  const keys = gpuLabelKeys(opts.gpuSpecs);
  const spec = gpuSpecForRole(opts.gpuSpecs, opts.gpuResource, opts.gpuVendor);
  const prevPd = isMap(opts.formLayer?.pd) ? opts.formLayer.pd : undefined;

  for (const role of PD_ROLES) {
    const edit = pd[role];
    const prevRole = prevPd && isMap(prevPd[role]) ? prevPd[role] : undefined;
    const products = canonicalizeProducts(edit.gpuProducts, opts.gpuSpecs);
    const prevGpuInfo = prevRole ? extractStandaloneGpuTerm(prevRole.affinityReplace, opts.gpuSpecs) : { products: [] };
    const hadPrevGpu = prevGpuInfo.products.length > 0;

    const pdMap = isMap(layer.pd) ? layer.pd : undefined;
    const roleMap = pdMap && isMap(pdMap[role]) ? pdMap[role] : undefined;

    if (products.length > 0) {
      const labelKey = spec?.labelKey || prevGpuInfo.key;
      if (labelKey) {
        const pdTarget = (isMap(layer.pd) ? layer.pd : (layer.pd = {})) as Tree;
        const roleTarget = (isMap(pdTarget[role]) ? pdTarget[role] : (pdTarget[role] = {})) as Tree;
        const terms = ensureRoleAffinityRequiredTerms(roleTarget);
        const kept = terms.filter((t) => !isStandaloneGpuProductTerm(t, keys));
        const values = spec?.labelKey ? expandProductValues(products, spec) : dedupe(products);
        kept.push({ matchExpressions: [{ key: labelKey, operator: "In", values }] });
        const na = (roleTarget.affinityReplace as Tree).nodeAffinity as Tree;
        (na[REQUIRED_NODE_PATH[1]] as Tree).nodeSelectorTerms = kept;
      }
    } else if (hadPrevGpu && roleMap && isMap(roleMap.affinityReplace)) {
      const aff = roleMap.affinityReplace;
      const terms = nodeSelectorTermsOf(aff);
      if (terms) {
        const kept = terms.filter((t) => !isStandaloneGpuProductTerm(t, keys));
        const na = aff.nodeAffinity as Tree;
        if (kept.length > 0) {
          (na[REQUIRED_NODE_PATH[1]] as Tree).nodeSelectorTerms = kept;
        } else {
          const hasPreferred = Array.isArray(na[PREFERRED_NODE_KEY]) && na[PREFERRED_NODE_KEY].length > 0;
          if (hasPreferred || Object.keys(na).some((k) => k !== REQUIRED_NODE_PATH[1] && k !== PREFERRED_NODE_KEY)) {
            na[REQUIRED_NODE_PATH[1]] = null;
          } else {
            delete aff.nodeAffinity;
          }
        }
      }
      if (!hasAnyAffinityRule(aff)) {
        roleMap.affinityReplace = null;
      }
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
