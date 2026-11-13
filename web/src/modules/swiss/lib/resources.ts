import type { HelmValues, Plan } from "@swiss/lib/api";
import { isMap } from "@swiss/lib/formLayer";
import { mergedHelmValues } from "@swiss/lib/imageSlots";

type Tree = Record<string, unknown>;

export type ResourceScope = "requests" | "limits";

export interface ResourceEdits {
  requests: Record<string, string>;
  limits: Record<string, string>;
}

export interface HelmResources {
  requests: Record<string, string>;
  limits: Record<string, string>;
  gpu?: {
    resource?: string;
    gpus?: string;
    pdRoles?: { role: "prefill" | "decode"; gpus: string }[];
  };
}

export interface ResourceDefaultRow {
  key: string;
  request: string;
  limit: string;
}

export interface CustomResourceRow {
  key: string;
  request: string;
  limit: string;
}

export interface GpuRequestSummary {
  resource: string;
  gpus: string;
  pdRoles?: { role: "prefill" | "decode"; gpus: string }[];
}

export type ResourceKeyProblem = "gpuReserved" | "exists" | "duplicate";

const RESOURCE_ORDER = new Map<string, number>([
  ["cpu", 0],
  ["memory", 1],
  ["ephemeral-storage", 2],
]);

export const emptyResourceEdits = (): ResourceEdits => ({ requests: {}, limits: {} });

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readResourceSection(raw: unknown): Record<string, string> {
  if (!isMap(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    const text = scalar(val);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

// Effective top-level resources and model GPU request from dry-run helmValues.
export function helmResources(values: Pick<HelmValues, "defaults" | "overrides">): HelmResources {
  const merged = mergedHelmValues(values);
  const res = isMap(merged.resources) ? merged.resources : undefined;
  const requests = readResourceSection(res?.requests);
  const limits = readResourceSection(res?.limits);

  const model = isMap(merged.model) ? merged.model : undefined;
  const resource = scalar(model?.gpuResource);
  const gpus = scalar(model?.gpus);

  const pd = isMap(merged.pd) && merged.pd.enabled === true ? merged.pd : undefined;
  const pdRoles: { role: "prefill" | "decode"; gpus: string }[] = [];
  if (pd) {
    for (const role of ["prefill", "decode"] as const) {
      const roleCfg = isMap(pd[role]) ? pd[role] : undefined;
      const roleGpus = scalar(roleCfg?.gpus);
      if (roleGpus !== undefined) pdRoles.push({ role, gpus: roleGpus });
    }
  }

  const gpu = resource || gpus || pdRoles.length
    ? { resource, gpus, ...(pdRoles.length ? { pdRoles } : {}) }
    : undefined;
  return { requests, limits, ...(gpu ? { gpu } : {}) };
}

export function gpuRequestSummary(opts: {
  base?: HelmResources;
  formGpuResource?: string;
  gpuResources?: string[];
  perPodGpus?: number;
}): GpuRequestSummary | undefined {
  const resource = opts.formGpuResource || opts.base?.gpu?.resource || opts.gpuResources?.[0] || "";
  const gpus = opts.base?.gpu?.gpus ?? (opts.perPodGpus && opts.perPodGpus > 0 ? String(opts.perPodGpus) : "");
  const pdRoles = opts.base?.gpu?.pdRoles;
  // Match _pod.tpl: empty or "0" means no GPU resource limit is emitted.
  if (!resource || gpus === "0" || (!gpus && (!pdRoles || pdRoles.length === 0))) return undefined;
  return { resource, gpus, ...(pdRoles?.length ? { pdRoles } : {}) };
}

export function compareResourceKeys(a: string, b: string): number {
  const pa = RESOURCE_ORDER.get(a);
  const pb = RESOURCE_ORDER.get(b);
  if (pa !== undefined && pb !== undefined) return pa - pb;
  if (pa !== undefined) return -1;
  if (pb !== undefined) return 1;
  const ha = a.startsWith("hugepages-");
  const hb = b.startsWith("hugepages-");
  if (ha !== hb) return ha ? -1 : 1;
  return a.localeCompare(b);
}

export function resourceEditsFromLayer(layer: Tree): ResourceEdits {
  const res = isMap(layer.resources) ? layer.resources : undefined;
  return {
    requests: readResourceSection(res?.requests),
    limits: readResourceSection(res?.limits),
  };
}

export function applyResourceEdits(overrides: Tree, edits: ResourceEdits | undefined): void {
  if (!edits) return;
  const requests = readResourceSection(edits.requests);
  const limits = readResourceSection(edits.limits);
  const out: Tree = {};
  if (Object.keys(requests).length) out.requests = requests;
  if (Object.keys(limits).length) out.limits = limits;
  if (Object.keys(out).length) overrides.resources = out;
}

// Removes form-layer scalar resource overrides that the form cleared back to default,
// while leaving null deletions or unknown sibling keys on base intact.
export function dropClearedResources(layer: Tree, edits: ResourceEdits | undefined): void {
  if (!isMap(layer.resources)) return;
  const res = layer.resources as Tree;
  for (const scope of ["requests", "limits"] as const) {
    const raw = res[scope];
    if (!isMap(raw)) continue;
    const section = raw as Tree;
    for (const [key, val] of Object.entries(section)) {
      if (scalar(val) === undefined) continue;
      if (scalar(edits?.[scope]?.[key]) === undefined) delete section[key];
    }
    if (Object.keys(section).length === 0) delete res[scope];
  }
  if (Object.keys(res).length === 0) delete layer.resources;
}

export function baseResourceRows(base?: HelmResources): ResourceDefaultRow[] {
  if (!base) return [];
  const keys = [...new Set([...Object.keys(base.requests), ...Object.keys(base.limits)])].sort(compareResourceKeys);
  return keys.map((key) => ({
    key,
    request: base.requests[key] ?? "",
    limit: base.limits[key] ?? "",
  }));
}

export function setResourceOverride(edits: ResourceEdits, key: string, scope: ResourceScope, value: string): ResourceEdits {
  const nextScope = { ...edits[scope] };
  if (value === "") delete nextScope[key];
  else nextScope[key] = value;
  return { ...edits, [scope]: nextScope };
}

export function clearResourceOverride(edits: ResourceEdits, key: string): ResourceEdits {
  const requests = { ...edits.requests };
  const limits = { ...edits.limits };
  delete requests[key];
  delete limits[key];
  return { requests, limits };
}

export function resourceKeyProblem(
  rawKey: string,
  opts: { gpuResource?: string; baseKeys?: Set<string>; duplicateKeys?: Set<string> },
): ResourceKeyProblem | undefined {
  const key = rawKey.trim();
  if (!key) return undefined;
  if (opts.gpuResource && key === opts.gpuResource) return "gpuReserved";
  if (opts.baseKeys?.has(key)) return "exists";
  if (opts.duplicateKeys?.has(key)) return "duplicate";
  return undefined;
}

function putResource(scope: Record<string, string>, key: string, raw: string) {
  const value = raw.trim();
  if (key && value) scope[key] = value;
}

// Default-row overrides and operator-added rows, as one resources map.
// A blank custom key is skipped. For a repeated key, the last non-empty
// request and the last non-empty limit win. A key that matches the GPU
// resource or a chart/site row is kept; the form only warns about it.
export function deriveResourceEdits(resources: ResourceEdits, custom: CustomResourceRow[]): ResourceEdits {
  const requests: Record<string, string> = {};
  const limits: Record<string, string> = {};
  for (const [key, value] of Object.entries(resources.requests)) putResource(requests, key.trim(), value);
  for (const [key, value] of Object.entries(resources.limits)) putResource(limits, key.trim(), value);
  for (const row of custom) {
    const key = row.key.trim();
    putResource(requests, key, row.request);
    putResource(limits, key, row.limit);
  }
  return { requests, limits };
}

const CHART_SITE_LAYERS = ["defaults", "catalog", "site"] as const;

// Form-layer keys that already exist on a chart or site layer stay overrides
// of those rows. Every other key is an operator-added row.
export function seedFormResources(layers: Plan["layers"] | undefined): { resources: ResourceEdits; customResources: CustomResourceRow[] } {
  const baseKeys = new Set<string>();
  for (const name of CHART_SITE_LAYERS) {
    const layer = layers?.[name];
    if (!isMap(layer)) continue;
    const edits = resourceEditsFromLayer(layer);
    for (const key of Object.keys(edits.requests)) baseKeys.add(key);
    for (const key of Object.keys(edits.limits)) baseKeys.add(key);
  }
  const form = isMap(layers?.form) ? resourceEditsFromLayer(layers.form) : emptyResourceEdits();
  const resources = emptyResourceEdits();
  const customKeys: string[] = [];
  for (const key of new Set([...Object.keys(form.requests), ...Object.keys(form.limits)])) {
    if (baseKeys.has(key)) {
      if (form.requests[key]) resources.requests[key] = form.requests[key];
      if (form.limits[key]) resources.limits[key] = form.limits[key];
    } else {
      customKeys.push(key);
    }
  }
  customKeys.sort(compareResourceKeys);
  return {
    resources,
    customResources: customKeys.map((key) => ({
      key,
      request: form.requests[key] ?? "",
      limit: form.limits[key] ?? "",
    })),
  };
}

export interface ResourceCustomView extends CustomResourceRow {
  error?: ResourceKeyProblem;
}

// Reads the form's default overrides and custom-row array. Custom rows are
// not copied into component state; handlers patch the arrays they are given.
export function useResourceRows(opts: {
  base?: HelmResources;
  resources: ResourceEdits;
  custom: CustomResourceRow[];
  gpuResource?: string;
  onResources: (next: ResourceEdits) => void;
  onCustom: (next: CustomResourceRow[]) => void;
}) {
  const { base, resources, custom, gpuResource, onResources, onCustom } = opts;
  const baseRows = baseResourceRows(base);
  const baseKeys = new Set(baseRows.map((r) => r.key));

  const counts = new Map<string, number>();
  for (const row of custom) {
    const key = row.key.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateKeys = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));

  const defaultRows = baseRows.map((r) => {
    const request = resources.requests[r.key] ?? "";
    const limit = resources.limits[r.key] ?? "";
    return {
      key: r.key,
      defaultRequest: r.request,
      defaultLimit: r.limit,
      request,
      limit,
      dirty: request !== "" || limit !== "",
      keyProblem: gpuResource && r.key === gpuResource ? ("gpuReserved" as const) : undefined,
    };
  });

  const customRows: ResourceCustomView[] = custom.map((row) => ({
    ...row,
    error: resourceKeyProblem(row.key, { gpuResource, baseKeys, duplicateKeys }),
  }));

  return {
    defaultRows,
    customRows,
    setDefaultValue: (key: string, scope: ResourceScope, next: string) => {
      onResources(setResourceOverride(resources, key, scope, next));
    },
    resetDefaultKey: (key: string) => {
      onResources(clearResourceOverride(resources, key));
    },
    addCustomRow: () => {
      onCustom([...custom, { key: "", request: "", limit: "" }]);
    },
    updateCustomRow: (index: number, patch: Partial<CustomResourceRow>) => {
      onCustom(custom.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    },
    removeCustomRow: (index: number) => {
      onCustom(custom.filter((_, i) => i !== index));
    },
  };
}
