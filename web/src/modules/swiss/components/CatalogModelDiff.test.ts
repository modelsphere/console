import { describe, expect, it } from "vitest";
import type { Entry } from "@swiss/lib/api";
import { catalogValues, lineDiff, modelText } from "./CatalogModelDiff";

const entry = {
  apiVersion: "catalog.swiss/v1",
  name: "m",
  version: "1.0.0",
  servedName: "served",
  source: { hf: "org/m" },
  variants: [
    {
      id: "v",
      engine: "sglang",
      chart: { name: "sglang", version: "0.8.0" },
      requires: { gpus: 2 },
      image: { repository: "repo", tag: "t", digest: "sha256:abc" },
      values: { extraArgs: ["--tp-size=2"], model: { name: "from-values" } },
    },
  ],
} as Entry;

describe("catalogValues", () => {
  it("projects a variant the way the catalog layer does", () => {
    expect(catalogValues(entry, "v").tree).toEqual({
      extraArgs: ["--tp-size=2"],
      model: { name: "served", gpus: "2" },
      image: { repository: "repo", tag: "t", digest: "sha256:abc" },
    });
  });

  it("is empty when the variant is no longer listed", () => {
    expect(catalogValues(entry, "missing")).toEqual({});
  });
});

describe("modelText", () => {
  it("shows a chart.version change that never enters the deployed values", () => {
    const values = { image: { tag: "t" } };
    const diff = lineDiff(
      modelText({ engine: "sglang", chart: { name: "sglang", version: "0.8.0" }, values }),
      modelText({ engine: "sglang", chart: { name: "sglang", version: "0.9.0" }, values }),
    );
    expect(diff).toContain("-  version: 0.8.0");
    expect(diff).toContain("+  version: 0.9.0");
    expect(diff).not.toContain("-  tag:");
  });
});

describe("lineDiff", () => {
  it("marks only the lines that moved", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe(" a\n-b\n+B\n c");
  });
});
