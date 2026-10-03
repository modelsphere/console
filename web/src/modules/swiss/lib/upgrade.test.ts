import { describe, expect, it } from "vitest";
import type { CatalogInfo } from "@swiss/lib/api";
import { movableCatalogs } from "./upgrade";

const catalogs: CatalogInfo[] = [
  { name: "public", url: "https://p", source: "https://p/index.json", default: true },
  { name: "internal", url: "https://i", source: "https://i/index.json" },
  { name: "mirror", url: "https://m", source: "https://m/index.json" },
];
const hfs: Record<string, string> = { public: "Qwen/Qwen3", internal: "Qwen/Qwen3", mirror: "acme/qwen3-finetune" };
const hfIn = (c?: string) => (c ? hfs[c] : undefined);

describe("movableCatalogs", () => {
  it("offers only catalogs with the plan's HF repo", () => {
    const got = movableCatalogs(catalogs, { catalogName: "public", hf: "Qwen/Qwen3" }, "public", hfIn);
    expect(got).toEqual({ hf: "Qwen/Qwen3", movable: ["internal"] });
  });

  it("takes an old plan's HF repo from its own catalog, by name or location", () => {
    expect(movableCatalogs(catalogs, { catalogName: "public" }, "public", hfIn).movable).toEqual(["internal"]);
    expect(movableCatalogs(catalogs, { catalog: "https://p/index.json" }, "public", hfIn).movable).toEqual([
      "internal",
    ]);
  });

  it("never asks the default for an old plan's identity", () => {
    // Unnamed, at a location the site does not list: the default is public, but
    // the release may not have come from it.
    expect(movableCatalogs(catalogs, { catalog: "/laptop/index.json" }, "public", hfIn)).toEqual({ movable: [] });
  });

  it("offers nothing when the own catalog cannot say", () => {
    expect(movableCatalogs(catalogs, { catalogName: "gone" }, undefined, hfIn)).toEqual({ movable: [] });
  });

  it("offers every same-model catalog when the own one is unlisted", () => {
    const got = movableCatalogs(catalogs, { catalogName: "gone", hf: "Qwen/Qwen3" }, undefined, hfIn);
    expect(got.movable).toEqual(["public", "internal"]);
  });
});
