import { describe, expect, it, vi } from "vitest";
import { api, type Plan, type PlanRequest } from "@swiss/lib/api";
import { composeDeploymentDraft, deploymentValuesRequest, DeploymentChangedError, readDeploymentRevision } from "./deployment-preview";
import { EMPTY } from "./deployment-settings";
import { recoverySettings } from "./recovery";
import { mergeValues, parseValues } from "./override-yaml";

const original: Plan = {
  apiVersion: "plan.swiss/v1", release: { name: "model", namespace: "models" },
  source: { model: "weights", variant: "gpu", version: "1", catalogName: "private" },
  chart: { name: "sglang", version: "0.9.32" }, engine: "sglang", profile: "site", hash: "old",
  layers: { catalog: { image: { tag: "catalog" } }, form: { replicaCount: 2, obsolete: true, sloRequirement: { enabled: true }, pd: { enabled: true, colocate: false } }, edit: {}, autoscale: { replicaCount: 4 } },
};

// Match the existing upgrade contract: form merges, while a submitted edit layer replaces.
function legacyCompose(request: PlanRequest, saved = original): Plan {
  const hasForm = Object.keys(request.overrides ?? {}).length > 0;
  const form = mergeValues(request.fromRelease ? saved.layers.form : {}, request.overrides ?? {});
  const edit = request.fromRelease && !hasForm ? saved.layers.edit : parseValues(request.editsYAML ?? "");
  const { autoscale: _autoscale, ...layers } = saved.layers;
  const pd = mergeValues(form, edit).pd as { enabled?: boolean; colocate?: boolean } | undefined;
  const on = (form.sloRequirement as { enabled?: boolean })?.enabled && pd?.enabled && !pd.colocate;
  return { ...saved, layers: { ...layers, form, edit, ...(request.fromRelease && on && saved.layers.autoscale ? { autoscale: saved.layers.autoscale } : {}) } };
}

describe("shared compose boundary", () => {
  it("keeps the existing form payload and fromRelease when saving partial YAML", async () => {
    const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockImplementation(async (request) => legacyCompose(request));
    const request = { fromRelease: "model", namespace: "models", overrides: { replicaCount: 2 }, editsYAML: "old: true" };
    const result = await composeDeploymentDraft(request, { custom: true }, compose);
    expect(compose).toHaveBeenCalledExactlyOnceWith({ ...request, catalog: undefined, editsYAML: "custom: true\n" });
    expect(result.layers.form).toEqual(original.layers.form);
    expect(result.layers.edit).toEqual({ custom: true });
    expect(result.layers.autoscale).toEqual(original.layers.autoscale);
    expect(mergeValues(result.layers.form, result.layers.edit)).toMatchObject({ replicaCount: 2, custom: true });
  });
  it("allows YAML to override a form value without deleting unrelated saved settings", async () => {
    const result = await composeDeploymentDraft({ fromRelease: "model", overrides: { replicaCount: 3 } }, { replicaCount: 3 }, async (request) => legacyCompose(request));
    expect(mergeValues(result.layers.form, result.layers.edit)).toEqual({ ...original.layers.form, replicaCount: 3 });
  });
  it("clears YAML-only overrides while retaining the saved form", async () => {
    const result = await composeDeploymentDraft({ fromRelease: "model", overrides: { replicaCount: 2 } }, {}, async (request) => legacyCompose(request));
    expect(result.layers.edit).toEqual({});
    expect(result.layers.form).toEqual(original.layers.form);
  });
  it("uses pinned target and the same form/edit layers for the effective preview", async () => {
    const result = await composeDeploymentDraft({ fromRelease: "model", overrides: { replicaCount: 3 } }, { custom: true }, async (request) => legacyCompose(request));
    const request = deploymentValuesRequest({ fromRelease: "model" }, result);
    expect(request).toMatchObject({ fromRelease: "model", overrides: result.layers.form, version: "1", variant: "gpu", chartVersion: "0.9.32" });
    expect(parseValues(request.editsYAML!)).toEqual(result.layers.edit);
    expect(legacyCompose(request).layers).toEqual(result.layers);
  });
  it("keeps the site Monitor policy in the effective document", async () => {
    const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>().mockImplementation(async (request) => legacyCompose(request));
    await composeDeploymentDraft({ overrides: { modelRoute: { monitor: { enabled: false } } } }, { modelRoute: { enabled: true, monitor: { enabled: true }, custom: "keep" } }, compose);
    expect(parseValues(compose.mock.calls[0][0].editsYAML!)).toEqual({ modelRoute: { enabled: true, monitor: { enabled: false }, custom: "keep" } });
  });

});

it("retains the existing explicit timeout/adaptive cleanup and previews its final request", async () => {
  const saved: Plan = { ...original, layers: { form: {
    image: { repository: "registry/engine", tag: "saved" }, custom: "keep",
    continuationGateway: { enabled: true, config: { continuationModel: "weights", stallIdleTimeoutSeconds: 45 } },
    modelRoute: { nginx: { values: { adaptive_cc: "true", adaptive_cc_min: "80" } } },
  }, edit: { previousYamlOnly: true } } };
  const values = { continuationGateway: { enabled: true, config: { continuationModel: "weights" } }, modelRoute: { nginx: { values: { adaptive_cc: "false" } } } };
  const settings = { form: { ...EMPTY, adaptiveCc: false }, recovery: { ...recoverySettings(saved.layers.form), idleTimeout: "" } };
  const requests: PlanRequest[] = [];
  const result = await composeDeploymentDraft({ fromRelease: "model", overrides: { modelRoute: { nginx: { values: { adaptive_cc: "false" } } } } }, values, async (input) => { requests.push(input); return legacyCompose(input, saved); }, undefined, settings);
  expect(requests).toHaveLength(3);
  expect(result.layers.form).toMatchObject({ image: saved.layers.form.image, custom: "keep" });
  expect(result.layers.form.continuationGateway).not.toHaveProperty("config.stallIdleTimeoutSeconds");
  expect(result.layers.form.modelRoute).not.toHaveProperty("nginx.values.adaptive_cc_min");
  expect(result.layers.edit).not.toHaveProperty("previousYamlOnly");
  const preview = deploymentValuesRequest(requests.at(-1)!, result);
  expect(preview.fromRelease).toBeUndefined();
  expect(legacyCompose(preview, saved).layers).toEqual(result.layers);
});

it("models the existing bare-upgrade behavior separately from a form submission", () => {
  const saved = { ...original, layers: { ...original.layers, edit: { savedEdit: true } } };
  expect(legacyCompose({ fromRelease: "model", editsYAML: "new: true" }, saved).layers.edit).toEqual({ savedEdit: true });
  expect(legacyCompose({ fromRelease: "model", overrides: { replicaCount: 2 }, editsYAML: "" }, saved).layers.edit).toEqual({});
});

describe("running revision snapshot", () => {
  it("checks the revision again after reading its actual values", async () => {
    vi.spyOn(api, "status").mockResolvedValue({ exists: true, revision: 7 } as Awaited<ReturnType<typeof api.status>>);
    vi.spyOn(api, "revisionValues").mockResolvedValue({ namespace: "models", release: "model", revision: 7, all: "replicaCount: 2\n", supplied: "" });
    const snapshot = await readDeploymentRevision("models", "model");
    expect(snapshot.revision).toBe(7);
    expect(api.status).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it("rejects an unrelated response and a revision changed during loading", async () => {
    const status = vi.spyOn(api, "status").mockResolvedValueOnce({ exists: true, revision: 7 } as Awaited<ReturnType<typeof api.status>>).mockResolvedValueOnce({ exists: true, revision: 8 } as Awaited<ReturnType<typeof api.status>>);
    vi.spyOn(api, "revisionValues").mockResolvedValue({ namespace: "models", release: "model", revision: 7, all: "{}", supplied: "" });
    await expect(readDeploymentRevision("models", "model")).rejects.toBeInstanceOf(DeploymentChangedError);
    status.mockResolvedValue({ exists: true, revision: 7 } as Awaited<ReturnType<typeof api.status>>);
    vi.mocked(api.revisionValues).mockResolvedValue({ namespace: "other", release: "model", revision: 7, all: "{}", supplied: "" });
    await expect(readDeploymentRevision("models", "model")).rejects.toBeInstanceOf(DeploymentChangedError);
    vi.restoreAllMocks();
  });
});


it("rejects YAML that conflicts with the locked deployment identity", async () => {
  const compose = vi.fn<(request: PlanRequest) => Promise<Plan>>();
  for (const serviceId of ["other", null]) await expect(composeDeploymentDraft({ fromRelease: "release", serviceId: "service" }, { serviceId }, compose)).rejects.toThrow("serviceId must match");
  expect(compose).not.toHaveBeenCalled();
});
