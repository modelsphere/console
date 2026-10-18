import { describe, expect, it } from "vitest";
import { EMPTY, reseed, siteSwitchDefaults, switchDefaults } from "./DeploySettings";

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
    expect(siteSwitchDefaults(r)).toEqual({ cart: true, serviceMonitor: true, sloRequirement: true, scaler: false, modelRoute: true });
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
