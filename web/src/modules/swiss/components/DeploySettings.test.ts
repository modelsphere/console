import { describe, expect, it } from "vitest";
import type { Input, Plan } from "@swiss/lib/api";
import { INPUTS_ANNOTATION } from "@swiss/lib/inputs";
import { applyFlags, EMPTY, formFromPlan, planRequest, reseed, siteSwitchDefaults, switchDefaults } from "./DeploySettings";

const site = { modelRoute: false, cart: true, serviceMonitor: false, sloRequirement: true, scaler: false };

describe("switchDefaults", () => {
  it("starts from the site's defaults", () => {
    expect(switchDefaults(site, undefined)).toEqual({ modelRoute: false, cart: true, serviceMonitor: false, slo: true, scaler: false });
  });

  it("takes the variant's own flag over the site's", () => {
    const got = switchDefaults(site, { scaler: { enabled: true }, cart: { maxLoad: 4 }, serviceMonitor: { enabled: "yes" } });
    expect(got).toEqual({ modelRoute: false, cart: true, serviceMonitor: false, slo: true, scaler: true });
  });

  it("seeds routing from the site alone, as compose does", () => {
    expect(switchDefaults(site, { modelRoute: { enabled: true } }).modelRoute).toBe(false);
  });

  it("is empty when neither says anything", () => {
    expect(switchDefaults(undefined, undefined)).toEqual({});
  });
});

describe("siteSwitchDefaults", () => {
  it("reads unset features as on, and routing from route.enabled", () => {
    const r = { source: "s", profile: { name: "x", model: { pathTemplate: "/m" }, defaults: { features: { scaler: false } }, route: { enabled: true } } };
    expect(siteSwitchDefaults(r)).toEqual({ cart: true, serviceMonitor: true, sloRequirement: true, scaler: false, modelRoute: true, cache: false });
  });

  it("is undefined without a parsed profile", () => {
    expect(siteSwitchDefaults({ source: "s", error: "bad" })).toBeUndefined();
    expect(siteSwitchDefaults(undefined)).toBeUndefined();
  });
});

describe("reseed", () => {
  it("moves untouched switches to the defaults", () => {
    const f = reseed(EMPTY, {}, { scaler: false, serviceMonitor: false });
    expect(f.scaler).toBe(false);
    expect(f.serviceMonitor).toBe(false);
    expect(f.cart).toBe(EMPTY.cart);
  });

  it("keeps a switch the operator flipped", () => {
    const flipped = { ...EMPTY, scaler: false };
    expect(reseed(flipped, {}, { scaler: true }).scaler).toBe(false);
  });

  it("follows new defaults, back to EMPTY where they say nothing", () => {
    const first = reseed(EMPTY, {}, { scaler: false });
    expect(reseed(first, { scaler: false }, {}).scaler).toBe(EMPTY.scaler);
  });

  it("returns the same form when nothing moves", () => {
    expect(reseed(EMPTY, {}, {})).toBe(EMPTY);
  });
});

describe("compile cache", () => {
  it("starts on when the site turns it on, over the variant's own off", () => {
    expect(switchDefaults({ cache: true }, { cache: { enabled: false } }).cache).toBe(true);
    expect(switchDefaults({ cache: false }, { cache: { enabled: true } }).cache).toBe(true);
    expect(switchDefaults({ cache: false }, undefined).cache).toBe(false);
  });

  it("is written only while on, and only for a chart that has the section", () => {
    const on = { ...EMPTY, cache: true, cacheHostPath: " /data/c ", cacheHostPathSuffix: "", cacheHistoryLimit: "3", cacheMaxSlots: "" };
    expect(planRequest(on, { model: "m" }).overrides?.cache).toEqual({ enabled: true, hostPath: "/data/c", historyLimit: 3 });
    expect(planRequest(on, { model: "m", cacheUnsupported: true }).overrides).not.toHaveProperty("cache");
    // Off writes nothing, never enabled: false.
    expect(planRequest({ ...on, cache: false }, { model: "m" }).overrides).not.toHaveProperty("cache");
  });

  it("seeds an upgrade from what the release ran with, the site's included", () => {
    const plan = (layers: Plan["layers"]) => ({ release: { name: "r", namespace: "n" }, layers }) as unknown as Plan;
    const bySite = formFromPlan(plan({ site: { cache: { enabled: true, hostPath: "/s" } }, form: {} }));
    expect(bySite.cache).toBe(true);
    expect(bySite.cacheHostPath).toBe("");
    const byForm = formFromPlan(plan({ site: { cache: { enabled: true } }, form: { cache: { enabled: false, maxSlotsPerNode: 2 } } }));
    expect(byForm.cache).toBe(false);
    expect(byForm.cacheMaxSlots).toBe("2");
    expect(formFromPlan(plan({})).cache).toBe(false);
  });
});

describe("applyFlags", () => {
  it("carries the form's per-apply switches", () => {
    expect(applyFlags(EMPTY)).toBeUndefined();
    expect(applyFlags({ ...EMPTY, skipSchemaValidation: true })).toEqual({ skipSchemaValidation: true });
    expect(applyFlags({ ...EMPTY, createNamespace: true })).toEqual({ createNamespace: true });
  });

  it("keeps the deprecated createNamespace on the plan request, for a swissd older than applyFlags", () => {
    const req = planRequest({ ...EMPTY, skipSchemaValidation: true, createNamespace: true }, { model: "m" });
    expect(req.createNamespace).toBe(true);
    expect(planRequest(EMPTY, { model: "m" }).createNamespace).toBeUndefined();
    // No released swissd took skipSchemaValidation on a plan request.
    expect(req).not.toHaveProperty("skipSchemaValidation");
  });

  it("starts off on an upgrade, whatever the plan says", () => {
    const plan = { release: { name: "r", namespace: "n" }, layers: {}, skipSchemaValidation: true, createNamespace: true } as unknown as Plan;
    expect(formFromPlan(plan)).toMatchObject({ skipSchemaValidation: false, createNamespace: false });
  });
});

describe("catalog input answers", () => {
  const master: Input = { key: "storageKVOffload.mooncake.master", title: "t", example: "e" };
  const arg: Input = { key: "extraArgs.[=--foo=1]", title: "t", example: "e" };
  const values = { extraArgs: ["--foo=1", "--bar"] };
  const annotation = JSON.stringify([
    { key: master.key, value: "mine:1" },
    { key: "old.flag", value: "gone" },
    { key: arg.key, value: "yes" },
  ]);

  it("records what the form writes and builds the form layer from the form alone", () => {
    const formLayer = {
      storageKVOffload: { mooncake: { master: "mine:1", protocol: "rdma" } },
      old: { flag: "gone", keep: 1 },
      extraArgs: ["--foo=OLD", "--bar"],
      untouched: 1,
    };
    const opts = { model: "m", inputs: [master, arg], values, formLayer, inputsAnnotation: annotation, siteInputs: [{ key: arg.key, value: "site-{{model}}" }], hf: "" };
    const seeded = formFromPlan(
      {
        release: { name: "r", namespace: "n" },
        layers: { form: { ...formLayer, model: { localPath: "/models/m" } } },
        additionalAnnotations: { [INPUTS_ANNOTATION]: annotation },
      } as unknown as Plan,
      undefined,
      { inputs: [master, arg], values },
    );
    expect(seeded.localPath).toBe("/models/m");
    expect(seeded.inputs).toEqual({ [master.key]: "mine:1", [arg.key]: "yes" });
    // The upgrade form prefills the release answers; master was retyped.
    const req = planRequest({ ...seeded, localPath: "", inputs: { ...seeded.inputs, [master.key]: " new:1 " } }, opts);
    // The release's form layer only reads the form back; none of it is carried.
    expect(req.overrides).toMatchObject({ storageKVOffload: { mooncake: { master: "new:1" } }, extraArgs: ["yes", "--bar"] });
    expect(req.overrides).not.toHaveProperty("storageKVOffload.mooncake.protocol");
    expect(req.overrides).not.toHaveProperty("old");
    expect(req.overrides).not.toHaveProperty("untouched");
    expect(JSON.parse(req.additionalAnnotations?.[INPUTS_ANNOTATION] ?? "")).toEqual([
      { key: master.key, value: "new:1" },
      { key: arg.key, value: "yes" },
    ]);
    // Clearing a prefilled answer falls back to the site's and drops it from the annotation.
    const cleared = planRequest({ ...EMPTY, inputs: { [master.key]: "new:1", [arg.key]: "" } }, opts);
    expect(cleared.overrides).toMatchObject({ extraArgs: ["site-m", "--bar"] });
    expect(JSON.parse(cleared.additionalAnnotations?.[INPUTS_ANNOTATION] ?? "")).toEqual([{ key: master.key, value: "new:1" }]);
    expect(formLayer.extraArgs).toEqual(["--foo=OLD", "--bar"]);
    expect(values.extraArgs).toEqual(["--foo=1", "--bar"]);
  });

  it("does not carry a cleared answer from a release with no annotation", () => {
    const formLayer = { storageKVOffload: { mooncake: { master: "old:1", protocol: "rdma" } }, extraArgs: ["--foo=OLD", "--bar"] };
    const req = planRequest({ ...EMPTY, inputs: { [master.key]: "" } }, { model: "m", inputs: [master, arg], values, formLayer, hf: "" });
    // Unanswered, nothing is written and the catalog's applies.
    expect(req.overrides).not.toHaveProperty("storageKVOffload");
    expect(req.overrides).not.toHaveProperty("extraArgs");
    expect(req.additionalAnnotations).toEqual({ [INPUTS_ANNOTATION]: "[]" });
  });

  it("does not carry a site or default write that no longer applies", () => {
    const withDefault: Input = { ...master, default: "def:1" };
    const formLayer = { storageKVOffload: { mooncake: { master: "def:1" } }, extraArgs: ["site-old", "--bar"] };
    const opts = { model: "m", inputs: [withDefault, arg], values, formLayer, inputsAnnotation: "[]", hf: "" };
    const req = planRequest(EMPTY, opts);
    expect(req.overrides).not.toHaveProperty("extraArgs");
    expect(req.overrides).toMatchObject({ storageKVOffload: { mooncake: { master: "def:1" } } });
    const noDefault = planRequest(EMPTY, { ...opts, inputs: [master, arg] });
    expect(noDefault.overrides).not.toHaveProperty("storageKVOffload.mooncake.master");
  });

  it("fills a list key from the site when nothing is typed", () => {
    const req = planRequest(EMPTY, { model: "glm", inputs: [arg], values, siteInputs: [{ key: arg.key, value: "mc-{{model}}" }], hf: "org/name" });
    expect(req.overrides?.extraArgs).toEqual(["mc-glm", "--bar"]);
    expect(req.additionalAnnotations).toEqual({ [INPUTS_ANNOTATION]: "[]" });
  });
});

describe("GPU resource", () => {
  it("is sent only when picked, and an upgrade starts on the resource the release runs on", () => {
    expect(planRequest({ ...EMPTY, gpuResource: "volcano.sh/Ascend910B4-1" }, { model: "m" }).gpuResource).toBe("volcano.sh/Ascend910B4-1");
    expect(planRequest(EMPTY, { model: "m" })).not.toHaveProperty("gpuResource", expect.anything());
    const plan = (layers: Plan["layers"]) => ({ release: { name: "r", namespace: "n" }, layers }) as unknown as Plan;
    expect(formFromPlan(plan({ derived: { model: { gpuResource: "volcano.sh/Ascend910B4-1" } } })).gpuResource).toBe("volcano.sh/Ascend910B4-1");
    expect(formFromPlan(plan({})).gpuResource).toBe("");
  });
});
