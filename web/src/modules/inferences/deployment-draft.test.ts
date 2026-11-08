import { describe, expect, it } from "vitest";
import { EMPTY } from "./deployment-settings";
import { draftForm, editDraftForm, seedDraft } from "./deployment-draft";
import { parseValues } from "./override-yaml";

const controls = { ...EMPTY, scaler: false, serviceId: "model", namespace: "models" };

describe("shared deployment draft", () => {
  it("projects the same YAML value into the structured form", () => {
    expect(draftForm(controls, "replicaCount: 2\n").replicaCount).toBe("2");
  });
  it("writes a form edit into the document without losing unrelated fields or comments", () => {
    const text = "# user configuration\nreplicaCount: 2\ncustom:\n  mode: fast\n";
    const edited = editDraftForm(text, draftForm(controls, text), { replicaCount: "3" });
    expect(parseValues(edited)).toEqual({ replicaCount: 3, custom: { mode: "fast" } });
    expect(edited).toContain("# user configuration");
  });
  it("preserves inherited defaults as absent until the user edits them", () => {
    const form = draftForm(controls, "", { replicaCount: 1, scaler: { enabled: false } });
    expect(form.replicaCount).toBe("1");
    expect(parseValues(editDraftForm("", form, { replicaCount: "3" }))).toEqual({ replicaCount: 3 });
  });
  it("clears a structured field by removing its override, rather than freezing a default", () => {
    const text = "replicaCount: 2\ncustom: true\n";
    expect(parseValues(editDraftForm(text, draftForm(controls, text), { replicaCount: "" }))).toEqual({ custom: true });
  });
  it("synchronizes nested image and resource fields while retaining unrepresented keys", () => {
    const text = "image:\n  repository: registry/engine\n  tag: old\n  pullPolicy: Always\n";
    const next = editDraftForm(text, draftForm(controls, text), { images: { image: { repository: "registry/engine", tag: "new" } } });
    expect(parseValues(next)).toEqual({ image: { repository: "registry/engine", tag: "new", pullPolicy: "Always" } });
  });
  it("retains deployment identity and flags outside the editable values", () => {
    const form = draftForm({ ...controls, skipSchemaValidation: true }, "namespace: untrusted\nserviceId: other\n");
    expect(form.namespace).toBe("models");
    expect(form.serviceId).toBe("model");
    expect(form.skipSchemaValidation).toBe(true);
  });
  it("retains every old explicit value, giving legacy YAML the previous precedence", () => {
    const initial = { ...controls, edits: "replicaCount: 4\ncustom: true\n" };
    expect(parseValues(seedDraft(initial, { replicaCount: 2, unknown: { keep: true } }))).toEqual({ replicaCount: 4, unknown: { keep: true }, custom: true });
  });
  it("refuses invalid YAML before a structured edit can replace its draft", () => {
    expect(() => editDraftForm("replicaCount: [", controls, { replicaCount: "3" })).toThrow();
  });
  it("keeps null deletion distinct from an absent inherited value", () => {
    expect(draftForm(controls, "replicaCount: null\n", { replicaCount: 1 }).replicaCount).toBe("");
  });
});

it("replaces a null ancestor when editing an image, preserving unrelated values", () => {
  const text = "# retained\nimage: null\ncustom: true\n";
  const next = editDraftForm(text, draftForm(controls, text), { images: { image: { repository: "registry/engine", tag: "new" } } });
  expect(parseValues(next)).toEqual({ image: { repository: "registry/engine", tag: "new" }, custom: true });
  expect(next).toContain("# retained");
});

it("projects and serializes typed catalog inputs using the same schema", () => {
  const context = { options: { inputs: [{ key: "model.port", title: "Port", example: 8000, type: "integer" as const }, { key: "feature", title: "Feature", example: true, type: "boolean" as const }] } };
  const form = draftForm(controls, "model:\n  port: 8000\nfeature: false\n", {}, context);
  expect(form.inputs).toEqual({ "model.port": "8000", feature: "false" });
  const next = editDraftForm(form.edits, form, { inputs: { "model.port": "9000", feature: "true" } }, context);
  expect(parseValues(next)).toEqual({ model: { port: 9000 }, feature: true });
});

it("keeps preset selection as metadata without materializing preset values", () => {
  const context = { profile: { name: "site", model: { pathTemplate: "" }, presets: { fast: { values: { extra: { mode: "fast" }, env: [{ name: "PRESET", value: "on" }] } } }, extra: { env: [{ name: "SITE", value: "keep" }] } }, options: { values: { env: [{ name: "CATALOG", value: "keep" }] } } };
  const text = "custom: true\nenv:\n  - name: USER\n    value: keep\n";
  const next = editDraftForm(text, draftForm(controls, text, {}, context), { preset: "fast" }, context);
  expect(next).toBe(text);
  expect(draftForm({ ...controls, preset: "fast" }, next, {}, context).preset).toBe("fast");
});

it("does not promote baseline images and resources into explicit form edits", () => {
  const baseline = { image: { repository: "registry/default", tag: "v1" }, resources: { requests: { cpu: "1" } } };
  const form = draftForm(controls, "custom: true\n", baseline, { options: { values: baseline, formLayer: {} } });
  expect(form.images).toEqual({});
  expect(form.resources).toEqual({ requests: {}, limits: {} });
  expect(form.customResources).toEqual([]);
});

it("preserves a deliberate affinity null instead of treating it as a missing key", () => {
  const text = "affinity:\n  nodeAffinity:\n    requiredDuringSchedulingIgnoredDuringExecution:\n      nodeSelectorTerms:\n        - matchExpressions:\n            - key: zone\n              operator: In\n              values: [west]\ncustom: true\n";
  const form = draftForm(controls, text);
  const next = editDraftForm(text, form, { affinity: form.affinity.map((rule) => ({ ...rule, drop: true })) });
  expect(parseValues(next)).toEqual({ affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: null } }, custom: true });
});

it("clears edited image and resource leaves without dropping unknown siblings", () => {
  const text = "image:\n  repository: registry/engine\n  tag: v1\n  pullPolicy: Always\nresources:\n  requests:\n    cpu: '2'\ncustom: true\n";
  const form = draftForm(controls, text);
  const next = editDraftForm(text, form, { images: { image: "" }, resources: { requests: {}, limits: {} }, customResources: [] });
  expect(parseValues(next)).toMatchObject({ image: { pullPolicy: "Always" }, custom: true });
  expect(parseValues(next).image).not.toHaveProperty("repository");
  expect((parseValues(next).resources as { requests?: object })?.requests ?? {}).not.toHaveProperty("cpu");
});

it("keeps custom resources distinct from inherited resource rows", () => {
  const text = "resources:\n  requests:\n    cpu: '2'\n    example.com/custom: '1'\n";
  const context = { options: { values: { resources: { requests: { cpu: "1" } } } } };
  const form = draftForm(controls, text, {}, context);
  expect(form.resources.requests).toEqual({ cpu: "2" });
  expect(form.customResources).toEqual([{ key: "example.com/custom", request: "1", limit: "" }]);
});

it("synchronizes PD role product aliases and preserves an explicit role clear", () => {
  const specifications = [{ vendor: "nvidia", resource: "example.com/gpu", labelKey: "example.com/product", products: [{ product: "H100", values: ["h100"] }, { product: "H800", values: ["h800"] }] }];
  const text = "pd:\n  prefill:\n    replicas: 2\n    affinityReplace:\n      nodeAffinity:\n        requiredDuringSchedulingIgnoredDuringExecution:\n          nodeSelectorTerms:\n            - matchExpressions:\n                - key: example.com/product\n                  operator: In\n                  values: [h100]\n";
  const stored = parseValues(text);
  const context = { options: { formLayer: stored, gpuSpecs: specifications, gpuVendor: "nvidia" } };
  const form = draftForm(controls, text, stored, context);
  expect(form.pd.prefill.gpuProducts).toEqual(["H100"]);
  const changed = editDraftForm(text, form, { pd: { ...form.pd, prefill: { gpuProducts: ["H800"] } } }, context);
  expect(draftForm(controls, changed, stored, context).pd.prefill.gpuProducts).toEqual(["H800"]);
  const cleared = editDraftForm(text, form, { pd: { ...form.pd, prefill: { gpuProducts: [] } } }, context);
  expect(draftForm(controls, cleared, stored, context).pd.prefill.gpuProducts).toEqual([]);
  expect(parseValues(cleared)).toMatchObject({ pd: { prefill: { replicas: 2, affinityReplace: null } } });
});

it("projects a selected preset as a baseline without overriding saved user settings", () => {
  const stored = { replicaCount: 7 };
  const context = { options: { formLayer: stored }, profile: { name: "site", model: { pathTemplate: "" }, presets: { fast: { values: { replicaCount: 4, modelRoute: { enabled: true } } } } } };
  expect(draftForm({ ...controls, preset: "fast" }, "", { replicaCount: 1 }, context)).toMatchObject({ preset: "fast", replicaCount: "7", modelRoute: true });
});
