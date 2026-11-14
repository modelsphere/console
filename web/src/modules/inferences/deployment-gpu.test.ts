import { expect, it } from "vitest";
import { applyResolvedGpu, configuredGpuProducts, gpuResolutionValues, resolvedGpuChanges } from "./deployment-gpu";
import { editDraftValues, seedDraft } from "./deployment-draft";
import { parseValues } from "./override-yaml";
import { EMPTY } from "./deployment-settings";
import { initialDraft, projection } from "./use-deployment-draft";
import type { Plan, GPUSpec } from "@swiss/lib/api";

const specifications: GPUSpec[] = [{ vendor: "nvidia", resource: "example.com/gpu", labelKey: "example.com/model", products: [{ product: "H100", values: ["h100"] }, { product: "H800", values: ["h800"] }] }];
const affinity = (product: string) => ({ nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: "example.com/model", operator: "In", values: [product] }] }] }, preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 10, preference: { matchExpressions: [{ key: "region", operator: "In", values: ["local"] }] } }] } });

it("replaces old required GPU terms with the server's resolution and retains preferred affinity", () => {
  const text = seedDraft(EMPTY, { affinity: affinity("h100"), custom: true });
  const input = gpuResolutionValues(text, specifications);
  expect(input).toMatchObject({ affinity: { nodeAffinity: { preferredDuringSchedulingIgnoredDuringExecution: affinity("h100").nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution } }, custom: true });
  expect(JSON.stringify(input)).not.toContain("h100");
  const resolved = { layers: { form: { affinity: affinity("h800") }, derived: { model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan;
  const changed = editDraftValues(text, resolvedGpuChanges(resolved, { ...EMPTY, edits: text, gpuProducts: ["H800"] }, specifications), parseValues(text));
  expect(configuredGpuProducts(parseValues(changed), specifications, [])).toEqual(["H800"]);
  expect(parseValues(changed)).toMatchObject({ custom: true, affinity: affinity("h800") });
});

it("clears a product restriction and projects YAML changes into the product selector", () => {
  const draft = initialDraft(EMPTY, { affinity: affinity("h800") });
  expect(projection(draft, {}, specifications).gpuProducts).toEqual(["H800"]);
  const changes = resolvedGpuChanges({ layers: { derived: { model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan, { ...EMPTY, edits: draft.text }, specifications);
  const cleared = editDraftValues(draft.text, changes, parseValues(draft.text));
  expect(configuredGpuProducts(parseValues(cleared), specifications, [])).toEqual([]);
  expect(JSON.stringify(parseValues(cleared))).toContain("preferredDuringSchedulingIgnoredDuringExecution");
  const deleted = seedDraft(EMPTY, { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: null } } } });
  expect(() => gpuResolutionValues(deleted, specifications)).not.toThrow();
  const resolved = { layers: { form: { affinity: affinity("h800") }, derived: { model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan;
  const restored = editDraftValues(deleted, resolvedGpuChanges(resolved, { ...EMPTY, edits: deleted, gpuProducts: ["H800"] }, specifications), parseValues(deleted));
  expect(configuredGpuProducts(parseValues(restored), specifications, [])).toEqual(["H800"]);
});

it("retains required zones, matchFields and selector term grouping when changing or clearing products", () => {
  const terms = ["west", "east"].map((zone) => ({
    matchExpressions: [{ key: "example.com/model", operator: "In", values: ["h100"] }, { key: "topology.kubernetes.io/zone", operator: "In", values: [zone] }],
    matchFields: [{ key: "metadata.name", operator: "NotIn", values: ["maintenance"] }],
  }));
  terms[1].matchExpressions[0].values = ["h800"];
  const text = seedDraft(EMPTY, { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: terms } } } });
  expect(configuredGpuProducts(parseValues(text), specifications, [])).toEqual(["H100", "H800"]);
  const resolved = { layers: { form: { affinity: affinity("h800") }, derived: { model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan;
  const form = { ...EMPTY, edits: text, gpuProducts: ["H800"] };
  const changed = editDraftValues(text, resolvedGpuChanges(resolved, form, specifications), parseValues(text));
  const serialized = JSON.stringify(parseValues(changed));
  expect(serialized).not.toContain("h100");
  for (const value of ["h800", "west", "east", "maintenance", "matchFields"]) expect(serialized).toContain(value);
  const cleared = editDraftValues(text, resolvedGpuChanges(resolved, { ...form, gpuProducts: [] }, specifications), parseValues(text));
  expect(JSON.stringify(parseValues(cleared))).not.toContain("h100");
  expect(JSON.stringify(parseValues(cleared))).toContain("topology.kubernetes.io/zone");
});


it("keeps an explicit GPU clear distinct from omitted YAML on upgrades", () => {
  const stored = { affinity: affinity("h100") };
  const draft = initialDraft(EMPTY, stored);
  const resolved = { layers: { derived: { model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan;
  const changes = resolvedGpuChanges(resolved, { ...EMPTY, edits: draft.text, gpuProducts: [] }, specifications);
  const cleared = { ...draft, text: applyResolvedGpu(draft.text, changes) };
  expect(projection(cleared, stored, specifications).gpuProducts).toEqual([]);
  expect(parseValues(cleared.text)).toMatchObject({ affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: null } } });
  expect(projection({ ...draft, text: "custom: true" }, stored, specifications).gpuProducts).toEqual(["H100"]);
});

it("resolves an automatic GPU choice from target defaults instead of reviving the saved choice", () => {
  const stored = { affinity: affinity("h100"), model: { gpuResource: "example.com/old" } };
  const draft = initialDraft(EMPTY, stored);
  const resolved = { layers: { derived: { affinity: affinity("h800"), model: { gpuResource: "example.com/gpu" } } } } as unknown as Plan;
  const changes = resolvedGpuChanges(resolved, { ...EMPTY, edits: draft.text }, specifications);
  const updated = { ...draft, text: applyResolvedGpu(draft.text, changes) };
  expect(projection(updated, stored, specifications)).toMatchObject({ gpuProducts: ["H800"], gpuResource: "example.com/gpu" });
});


it("uses target catalog/site GPU constraints even when derived omits them", () => {
  const text = seedDraft(EMPTY, { affinity: affinity("h100"), model: { gpuResource: "example.com/old" } });
  const plan = { layers: { catalog: { affinity: affinity("h100") }, site: { affinity: affinity("h800") }, derived: {} } } as unknown as Plan;
  const defaults = { model: { gpuResource: "example.com/default" } };
  const changes = resolvedGpuChanges(plan, { ...EMPTY, edits: text }, specifications, defaults);
  const updated = applyResolvedGpu(text, changes);
  expect(projection({ ...initialDraft(EMPTY), text: updated }, {}, specifications)).toMatchObject({ gpuProducts: ["H800"], gpuResource: "example.com/default" });
});


it("keeps default-resource GPU selection compatible with charts that omit gpuResource", () => {
  const text = seedDraft(EMPTY, { affinity: affinity("h100") });
  const plan = { chart: { name: "sglang", version: "0.8.0" }, layers: { form: { affinity: affinity("h800") }, derived: {} } } as unknown as Plan;
  const changes = resolvedGpuChanges(plan, { ...EMPTY, edits: text, gpuProducts: ["H800"] }, specifications, {}, {});
  const updated = parseValues(applyResolvedGpu(text, changes));
  expect(configuredGpuProducts(updated, specifications, [])).toEqual(["H800"]);
  expect(updated.model).not.toHaveProperty("gpuResource");
});
