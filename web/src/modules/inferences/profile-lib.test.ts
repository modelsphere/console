import { describe, expect, it } from "vitest";
import type { SiteProfile } from "@swiss/lib/api";
import { fromRows, markDefault, profileErrors, toRows, withNodes } from "@/modules/inferences/profile-lib";

describe("key-value rows", () => {
  it("round-trips a table and drops rows without a key", () => {
    expect(toRows({ a: "1" })).toEqual([{ key: "a", value: "1" }]);
    expect(fromRows([{ key: " a ", value: "1" }, { key: "", value: "x" }])).toEqual({ a: "1" });
    expect(fromRows([{ key: "", value: "" }])).toBeUndefined();
    expect(toRows(undefined)).toEqual([]);
  });
});

describe("profileErrors", () => {
  it("needs a name and a path template", () => {
    expect(profileErrors({ name: "", model: { pathTemplate: "" } } as SiteProfile)).toEqual(["name", "pathTemplate"]);
    expect(profileErrors({ name: "x", model: { pathTemplate: "/m/{{name}}" } } as SiteProfile)).toEqual([]);
  });
});

describe("markDefault", () => {
  const cs = [{ name: "a", url: "u", default: true }, { name: "b", url: "v" }];
  it("keeps one default", () => {
    expect(markDefault(cs, 1, true).map((c) => c.default)).toEqual([false, true]);
    expect(markDefault(cs, 0, false).map((c) => c.default)).toEqual([false, undefined]);
  });
});

describe("profileErrors with catalogs", () => {
  it("blocks the save on a bad catalog row", () => {
    expect(profileErrors({ name: "x", model: { pathTemplate: "/m" }, catalogs: [{ name: "", url: "/c" }] } as SiteProfile)).toEqual(["catalogs"]);
  });
});

describe("nodes", () => {
  const aliases = { "Ascend-910B3": ["accelerator=huawei-Ascend910"] };

  it("keeps the aliases when GPUs per node is edited, and the reverse", () => {
    expect(withNodes({ gpusPerNode: 8, gpuProductAliases: aliases }, { gpusPerNode: 16 })).toEqual({ gpusPerNode: 16, gpuProductAliases: aliases });
    expect(withNodes({ gpusPerNode: 8, gpuProductAliases: aliases }, { gpusPerNode: undefined })).toMatchObject({ gpuProductAliases: aliases });
    expect(withNodes({ gpusPerNode: 8 }, { gpuProductAliases: aliases })).toEqual({ gpusPerNode: 8, gpuProductAliases: aliases });
    expect(withNodes({ gpusPerNode: 8 }, { gpusPerNode: undefined })).toBeUndefined();
  });

  it("blocks the save on a bad alias", () => {
    const p: SiteProfile = { name: "c", model: { pathTemplate: "/m" } };
    expect(profileErrors({ ...p, nodes: { gpuProductAliases: aliases } })).toEqual([]);
    expect(profileErrors({ ...p, nodes: { gpuProductAliases: { A: ["accelerator"] } } })).toEqual(["gpuAliases"]);
    expect(profileErrors({ ...p, nodes: { gpuProductAliases: { A: ["a=1"], B: ["b=1"] } } })).toEqual(["gpuAliases"]);
  });
});

