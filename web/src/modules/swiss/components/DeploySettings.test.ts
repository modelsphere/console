import { describe, expect, it } from "vitest";
import type { Plan } from "@swiss/lib/api";
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
