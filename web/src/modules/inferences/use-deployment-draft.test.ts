import { expect, it } from "vitest";
import { initialDraft, changeForm, projection, changeRecovery } from "./use-deployment-draft";
import { EMPTY, planRequest } from "./deployment-settings";
import { parseValues } from "./override-yaml";
import { recoverySettings } from "./recovery";

it("commits all pending fields after correcting an invalid number", () => {
  let draft = initialDraft({ ...EMPTY, scaler: false, images: { image: { repository: "registry/old", tag: "v1" } }, replicaCount: "2" });
  draft = changeForm(draft, { replicaCount: "bad" }, {});
  draft = changeForm(draft, { images: { image: { repository: "registry/new", tag: "v2" } } }, {});
  draft = changeForm(draft, { replicaCount: "3" }, {});
  expect(parseValues(draft.text)).toMatchObject({ replicaCount: 3, image: { repository: "registry/new", tag: "v2" } });
  expect(projection(draft, {}).images.image).toEqual({ repository: "registry/new", tag: "v2" });
});

it("preserves unknown recovery config when disabling the feature", () => {
  const values = { continuationGateway: { enabled: true, config: { continuationModel: "weights", custom: true } } };
  let draft = initialDraft(EMPTY, values);
  draft = changeRecovery(draft, { enabled: false }, {});
  expect(parseValues(draft.text)).toMatchObject({ continuationGateway: { enabled: false, config: { continuationModel: "weights", custom: true } } });
  expect(recoverySettings(parseValues(draft.text)).enabled).toBe(false);
  draft = changeRecovery(draft, { enabled: true }, {});
  expect(recoverySettings(parseValues(draft.text)).model).toBe("weights");
});

it("explicitly disables a cache inherited from the target baseline", () => {
  const baseline = { cache: { enabled: true, hostPath: "/models/cache" } };
  let draft = initialDraft({ ...EMPTY, cache: true }, {});
  draft = changeForm(draft, { cache: false }, baseline);
  expect(parseValues(draft.text)).toMatchObject({ cache: { enabled: false } });
  expect(projection(draft, baseline).cache).toBe(false);
});

it("keeps cache settings across an off/on toggle", () => {
  const values = { cache: { enabled: true, hostPath: "/models/custom", historyLimit: 8, custom: "keep" } };
  let draft = initialDraft(EMPTY, values);
  draft = changeForm(draft, { cache: false }, {});
  expect(parseValues(draft.text)).toEqual({ cache: { ...values.cache, enabled: false } });
  draft = changeForm(draft, { cache: true }, {});
  expect(parseValues(draft.text)).toEqual(values);
});

it("keeps hidden scaling, routing and monitoring values across switch changes", () => {
  const values = {
    replicaCount: 2,
    scaler: { enabled: true, minReplicas: 1, maxReplicas: 4 },
    cart: { enabled: true },
    modelRoute: { cart: { maxLoad: 8 }, monitor: { enabled: true, model: "weights" } },
  };
  let draft = initialDraft(EMPTY, values);
  draft = changeForm(draft, { scaler: false, cart: false, monitor: false }, {});
  expect(parseValues(draft.text)).toMatchObject({
    replicaCount: 2,
    scaler: { enabled: false, minReplicas: 1, maxReplicas: 4 },
    cart: { enabled: false },
    modelRoute: { cart: { maxLoad: 8 }, monitor: { enabled: false, model: "weights" } },
  });
  draft = changeForm(draft, { scaler: true, cart: true, monitor: true }, {});
  const { replicaCount: _fixed, ...scaling } = values;
  expect(parseValues(draft.text)).toEqual(scaling);
});

it("keeps a model path bound to the YAML value on upgrades", () => {
  let draft = initialDraft({ ...EMPTY, localPath: "/models/old" }, { model: { localPath: "/models/old", custom: true } });
  draft = changeForm(draft, { localPath: "/models/new" }, {});
  expect(parseValues(draft.text)).toEqual({ model: { localPath: "/models/new", custom: true } });
  expect(projection(draft, {}).localPath).toBe("/models/new");
});


it("retains saved form settings when a partial YAML document omits them", () => {
  const stored = { replicaCount: 2, image: { repository: "registry/engine", tag: "saved" }, continuationGateway: { enabled: false, config: { continuationModel: "weights" } }, custom: true };
  let draft = initialDraft(EMPTY, stored);
  draft = changeForm(draft, { edits: "image:\n  tag: new\n" }, stored);
  expect(projection(draft, stored)).toMatchObject({ replicaCount: "2", images: { image: { repository: "registry/engine", tag: "new" } } });
  draft = changeForm(draft, { replicaCount: "3" }, stored);
  expect(parseValues(draft.text)).toEqual({ image: { tag: "new" }, replicaCount: 3 });
  expect(projection(draft, stored).replicaCount).toBe("3");
});

it("buffers an invalid typed integer without breaking the YAML document", () => {
  const context = { options: { inputs: [{ key: "model.port", title: "Port", example: 8000, type: "integer" as const }] } };
  let draft = initialDraft(EMPTY, { model: { port: 8000 } }, context);
  draft = changeForm(draft, { inputs: { "model.port": "wrong" } }, {}, context);
  expect(parseValues(draft.text)).toEqual({ model: { port: 8000 } });
  expect(projection(draft, {}, [], context).inputs["model.port"]).toBe("wrong");
  draft = changeForm(draft, { inputs: { "model.port": "9000" } }, {}, context);
  expect(parseValues(draft.text)).toEqual({ model: { port: 9000 } });
});

it("replaces an edited custom resource value directly or through an empty intermediate value", () => {
  const context = { options: { formLayer: {}, values: {} } };
  for (const sequence of [["3"], ["", "3"]]) {
    let draft = initialDraft(EMPTY, { resources: { requests: { cpu: "2" } }, unrelated: true }, context);
    for (const request of sequence) {
      const form = projection(draft, {}, [], context);
      draft = changeForm(draft, { customResources: form.customResources.map((row) => row.key === "cpu" ? { ...row, request } : row) }, {}, context);
      expect(projection(draft, {}, [], context).customResources).toEqual([{ key: "cpu", request, limit: "" }]);
      const resources = parseValues(draft.text).resources as { requests?: Record<string, unknown> } | undefined;
      expect(resources?.requests?.cpu).toBe(request || undefined);
    }
    expect(parseValues(draft.text)).toMatchObject({ resources: { requests: { cpu: "3" } }, unrelated: true });
  }
});

it("switches presets repeatedly while retaining explicit image, env and resource overrides", () => {
  const context = { options: { formLayer: {}, values: {} }, profile: {
    name: "site", model: { pathTemplate: "" }, presets: {
      first: { values: { replicaCount: 2, resources: { requests: { cpu: "2" } }, image: { repository: "registry/first", tag: "v1" }, env: [{ name: "PRESET", value: "first" }] } },
      second: { values: { replicaCount: 4, resources: { requests: { cpu: "4" } }, image: { repository: "registry/second", tag: "v2" }, env: [{ name: "PRESET", value: "second" }] } },
    },
  } };
  const initial = { ...EMPTY, scaler: false, serviceId: "model" };
  let draft = initialDraft(initial, {}, context);
  draft = changeForm(draft, { preset: "first" }, {}, context);
  expect(projection(draft, {}, [], context)).toMatchObject({ preset: "first", replicaCount: "2", images: {}, customResources: [] });
  expect(parseValues(draft.text)).toEqual({});
  draft = changeForm(draft, { preset: "second" }, {}, context);
  expect(projection(draft, {}, [], context)).toMatchObject({ preset: "second", replicaCount: "4", images: {}, customResources: [] });
  expect(parseValues(draft.text)).toEqual({});
  const request = planRequest(projection(draft, {}, [], context), { model: "model", ...context.options }, context.profile);
  expect(request.overrides).toMatchObject({ resources: { requests: { cpu: "4" } }, image: { repository: "registry/second", tag: "v2" }, env: [{ name: "PRESET", value: "second" }] });
  draft = changeForm(draft, { edits: "replicaCount: 7\nresources:\n  requests:\n    cpu: '8'\nimage:\n  repository: registry/user\n  tag: custom\nenv:\n  - name: USER\n    value: keep\n" }, {}, context);
  const before = draft.text;
  draft = changeForm(draft, { preset: "first" }, {}, context);
  expect(draft.text).toBe(before);
  const form = projection(draft, {}, [], context);
  expect(form).toMatchObject({ preset: "first", replicaCount: "7", images: { image: { repository: "registry/user", tag: "custom" } } });
  expect(form.customResources).toEqual([{ key: "cpu", request: "8", limit: "" }]);
  expect(parseValues(draft.text).env).toEqual([{ name: "USER", value: "keep" }]);
});
