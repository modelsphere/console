import { useEffect, useRef, useState } from "react";
import type { HelmValues } from "@swiss/lib/api";
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

export const COMMON_RESOURCE_KEYS = [
  "cpu",
  "memory",
  "ephemeral-storage",
  "hugepages-2Mi",
  "hugepages-1Gi",
  "rdma/hca_shared",
] as const;

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

export function customResourceRows(base: HelmResources | undefined, edits: ResourceEdits): CustomResourceRow[] {
  const baseKeys = new Set(baseResourceRows(base).map((r) => r.key));
  const customKeys = [...new Set([...Object.keys(edits.requests), ...Object.keys(edits.limits)])]
    .filter((k) => !baseKeys.has(k))
    .sort(compareResourceKeys);
  return customKeys.map((key) => ({
    key,
    request: edits.requests[key] ?? "",
    limit: edits.limits[key] ?? "",
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

export function replaceCustomResources(
  base: HelmResources | undefined,
  edits: ResourceEdits,
  custom: CustomResourceRow[],
  gpuResource?: string,
): ResourceEdits {
  const baseKeys = new Set(baseResourceRows(base).map((r) => r.key));
  const requests: Record<string, string> = {};
  const limits: Record<string, string> = {};

  for (const [k, v] of Object.entries(edits.requests)) {
    if (baseKeys.has(k) && v.trim()) requests[k] = v;
  }
  for (const [k, v] of Object.entries(edits.limits)) {
    if (baseKeys.has(k) && v.trim()) limits[k] = v;
  }

  const seen = new Set<string>();
  for (const row of custom) {
    const key = row.key.trim();
    if (!key || baseKeys.has(key) || (gpuResource && key === gpuResource) || seen.has(key)) continue;
    seen.add(key);
    if (row.request.trim()) requests[key] = row.request;
    if (row.limit.trim()) limits[key] = row.limit;
  }
  return { requests, limits };
}

// _pod.tpl adds cpu=1 / memory=4Gi defaults when a hugepages-* limit is set
// without cpu or memory; surface the K8s requirement while editing.
export function needsHugepageComputeHint(base: HelmResources | undefined, edits: ResourceEdits, drafts?: CustomResourceRow[]): boolean {
  const reqs: Record<string, string> = { ...(base?.requests ?? {}), ...edits.requests };
  const lims: Record<string, string> = { ...(base?.limits ?? {}), ...edits.limits };
  for (const d of drafts ?? []) {
    const key = d.key.trim();
    if (!key) continue;
    if (d.request.trim()) reqs[key] = d.request.trim();
    if (d.limit.trim()) lims[key] = d.limit.trim();
  }
  const hasHugepage = [...Object.entries(reqs), ...Object.entries(lims)].some(
    ([k, v]) => k.startsWith("hugepages-") && v.trim() !== "",
  );
  if (!hasHugepage) return false;
  const hasCpuOrMemory = ["cpu", "memory"].some((k) => (reqs[k]?.trim() ?? "") !== "" || (lims[k]?.trim() ?? "") !== "");
  return !hasCpuOrMemory;
}

export interface ResourceDraftRow extends CustomResourceRow {
  id: number;
  error?: ResourceKeyProblem;
}

export function useResourceRows(opts: {
  base?: HelmResources;
  value: ResourceEdits;
  gpuResource?: string;
  onChange: (next: ResourceEdits) => void;
}) {
  const { base, value, gpuResource, onChange } = opts;
  const baseRows = baseResourceRows(base);
  const baseKeys = new Set(baseRows.map((r) => r.key));
  const baseKeysKey = baseRows.map((r) => r.key).join("\0");

  const nextIdRef = useRef(1);
  const lastEmittedRef = useRef<ResourceEdits | null>(null);
  const prevBaseKeysRef = useRef(baseKeysKey);

  const [drafts, setDrafts] = useState<Array<CustomResourceRow & { id: number }>>(() =>
    customResourceRows(base, value).map((r) => ({ id: nextIdRef.current++, ...r })),
  );

  const emit = (next: ResourceEdits) => {
    lastEmittedRef.current = next;
    onChange(next);
  };

  useEffect(() => {
    const baseChanged = baseKeysKey !== prevBaseKeysRef.current;
    prevBaseKeysRef.current = baseKeysKey;
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setDrafts((prev) => {
        const seeded = customResourceRows(base, value);
        if (prev.length === 0 && seeded.length === 0) return prev;
        return seeded.map((r) => ({ id: nextIdRef.current++, ...r }));
      });
      return;
    }
    if (baseChanged) {
      setDrafts((prev) => {
        const next = prev.filter((d) => !d.key.trim() || !baseKeys.has(d.key.trim()));
        return next.length === prev.length ? prev : next;
      });
    }
  }, [value, baseKeysKey]);

  const counts = new Map<string, number>();
  for (const d of drafts) {
    const k = d.key.trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const duplicateKeys = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  const usedKeys = new Set([...baseKeys, ...counts.keys()]);

  const defaultRows = baseRows.map((r) => {
    const request = value.requests[r.key] ?? "";
    const limit = value.limits[r.key] ?? "";
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

  const customRows: ResourceDraftRow[] = drafts.map((d) => ({
    ...d,
    error: resourceKeyProblem(d.key, { gpuResource, baseKeys, duplicateKeys }),
  }));

  const setDefaultValue = (key: string, scope: ResourceScope, next: string) => {
    emit(setResourceOverride(value, key, scope, next));
  };

  const resetDefaultKey = (key: string) => {
    emit(clearResourceOverride(value, key));
  };

  const addCustomRow = () => {
    setDrafts((prev) => [...prev, { id: nextIdRef.current++, key: "", request: "", limit: "" }]);
  };

  const updateCustomRow = (id: number, patch: Partial<CustomResourceRow>) => {
    const nextDrafts = drafts.map((d) => (d.id === id ? { ...d, ...patch } : d));
    setDrafts(nextDrafts);
    emit(replaceCustomResources(base, value, nextDrafts, gpuResource));
  };

  const removeCustomRow = (id: number) => {
    const nextDrafts = drafts.filter((d) => d.id !== id);
    setDrafts(nextDrafts);
    emit(replaceCustomResources(base, value, nextDrafts, gpuResource));
  };

  const keyChoicesFor = (currentKey: string): string[] => {
    const cur = currentKey.trim();
    return COMMON_RESOURCE_KEYS.filter((k) => k !== gpuResource && (!usedKeys.has(k) || k === cur));
  };

  return {
    defaultRows,
    customRows,
    setDefaultValue,
    resetDefaultKey,
    addCustomRow,
    updateCustomRow,
    removeCustomRow,
    keyChoicesFor,
    hugepageHint: needsHugepageComputeHint(base, value, drafts),
  };
}
