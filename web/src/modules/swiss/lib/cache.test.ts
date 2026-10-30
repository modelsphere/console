import { describe, expect, it } from "vitest";
import type { SiteProfile } from "@swiss/lib/api";
import { cacheCard, cacheDefaults, cacheFieldError } from "./cache";

const site = (cache?: SiteProfile["cache"], gpusPerNode?: number): SiteProfile => ({ name: "s", model: { pathTemplate: "/m" }, cache, nodes: { gpusPerNode } });

describe("cacheDefaults", () => {
  it("is the chart's when neither the site nor the variant says", () => {
    expect(cacheDefaults(site(), { requires: { gpus: 2 } })).toEqual({ hostPath: "/mnt/disk0/sglang-cache", historyLimit: 2, maxSlotsPerNode: 8 });
  });

  it("takes the site's path and derives the slots only when the site turns the cache on", () => {
    expect(cacheDefaults(site({ enabled: true, hostPath: "/data/cache" }, 8), { requires: { gpus: 2 } })).toEqual({ hostPath: "/data/cache", historyLimit: 2, maxSlotsPerNode: 4 });
    expect(cacheDefaults(site({ hostPath: "/data/cache" }, 8), { requires: { gpus: 2 } })).toEqual({ hostPath: "/mnt/disk0/sglang-cache", historyLimit: 2, maxSlotsPerNode: 8 });
    expect(cacheDefaults(site({ enabled: true }, 4), { requires: { gpus: 8 } }).maxSlotsPerNode).toBe(1);
  });

  it("keeps the variant's own slots over the derived ones, and its path under the site's", () => {
    const variant = { requires: { gpus: 2 }, values: { cache: { hostPath: "/v", historyLimit: 5, maxSlotsPerNode: 3 } } };
    expect(cacheDefaults(site({ enabled: true }, 8), variant)).toEqual({ hostPath: "/v", historyLimit: 5, maxSlotsPerNode: 3 });
    expect(cacheDefaults(site({ enabled: true, hostPath: "/s" }, 8), variant).hostPath).toBe("/s");
  });
});

describe("cacheFieldError", () => {
  it("holds the chart's schema bounds, and empty is fine", () => {
    expect(cacheFieldError("historyLimit", "")).toBe(false);
    expect(cacheFieldError("historyLimit", "0")).toBe(true);
    expect(cacheFieldError("historyLimit", "100")).toBe(false);
    expect(cacheFieldError("maxSlotsPerNode", "64")).toBe(false);
    expect(cacheFieldError("maxSlotsPerNode", "65")).toBe(true);
  });
});

describe("cacheCard", () => {
  it("carries the site's switch beside why the chart cannot take it", () => {
    const card = cacheCard(site({ enabled: true }, 8), { requires: { gpus: 8 } }, { name: "vllm", version: "0.8.22" });
    expect(card.siteOn).toBe(true);
    expect(card.unsupported).toEqual({ chart: "vllm" });
    expect(cacheCard(site(), undefined, { name: "sglang", version: ">=0.7.1" })).toMatchObject({ siteOn: false, unsupported: undefined });
  });
});
