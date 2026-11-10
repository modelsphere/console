import { describe, expect, it } from "vitest";
import type { SiteProfile } from "@swiss/lib/api";
import { fromRows, markDefault, profileErrors, toRows, withNodes } from "@/modules/inferences/profile-lib";
import { answersText, parseAnswers } from "@swiss/lib/inputs";

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
  const gpus = [{ vendor: "nvidia", resource: "nvidia.com/gpu", labelKey: "nvidia.com/gpu.product" }];
  const aliases = { "Ascend-910B3": ["accelerator=huawei-Ascend910"] };

  it("keeps the GPU table when GPUs per node is cleared, and an empty table as one", () => {
    expect(withNodes({ gpusPerNode: 8, gpus }, { gpusPerNode: undefined })).toEqual({ gpusPerNode: undefined, gpus });
    expect(withNodes({ gpusPerNode: 8, gpus }, { gpus: [] })).toEqual({ gpusPerNode: 8, gpus: [] });
    expect(withNodes({ gpus, gpuProductAliases: aliases }, { gpuProductAliases: undefined })).toEqual({ gpus, gpuProductAliases: undefined });
    expect(withNodes({ gpusPerNode: 8 }, { gpusPerNode: undefined })).toBeUndefined();
  });

  it("blocks the save on a bad GPU entry, and ignores aliases", () => {
    const p: SiteProfile = { name: "c", model: { pathTemplate: "/m" } };
    expect(profileErrors({ ...p, nodes: { gpus, gpuProductAliases: { A: ["accelerator"] } } })).toEqual([]);
    expect(profileErrors({ ...p, nodes: { gpus: [...gpus, { vendor: "ascend", resource: "nvidia.com/gpu", labelKey: "x" }] } })).toEqual(["gpus"]);
    expect(profileErrors({ ...p, nodes: { gpus: [{ vendor: "ascend", resource: "r", labelKey: "" }] } })).toEqual(["gpus"]);
  });
});


describe("input answers", () => {
  it("maps a profile's answers to rows and back", () => {
    const inputs = { "a.master": "mc:1", "a.port": 8000, "a.on": true };
    expect(parseAnswers(answersText(inputs))).toEqual(inputs);
    expect(parseAnswers(fromRows(toRows(answersText(inputs))))).toEqual(inputs);
    expect(parseAnswers(fromRows([]))).toBeUndefined();
  });
});
