import { describe, expect, it } from "vitest";
import { computedYaml, keyLines, mergeValues, overrideEdit, overridePaths, parseValues, readYaml, searchKeys } from "./override-yaml";

const defaults = `# Engine replicas.
replicaCount: 1
image:
  # Registry and repository.
  repository: example.com/engine
  # Tag; the chart appVersion when empty.
  tag: chart
flags: ["--chart"]
probe:
  path: /health
  # Port the probe hits.
  port: 8000
`;

const overrides = `replicaCount: 2
image:
  tag: catalog
flags: ["--catalog"]
probe:
  port: null
extra:
  on: true
`;

describe("override YAML", () => {
  it("writes the overrides into the chart's values.yaml, its comments kept", () => {
    const computed = computedYaml(defaults, overrides);
    expect(computed).toContain("# Engine replicas.\nreplicaCount: 2\n");
    expect(computed).toContain("  # Tag; the chart appVersion when empty.\n  tag: catalog\n");
    expect(computed).toContain("  repository: example.com/engine\n");
    expect(computed).not.toContain("Port the probe hits");
    expect(parseValues(computed)).toEqual({
      replicaCount: 2, image: { repository: "example.com/engine", tag: "catalog" }, flags: ["--catalog"],
      probe: { path: "/health" }, extra: { on: true },
    });
    expect(computed.trimEnd().endsWith("extra:\n  on: true")).toBe(true);
  });

  it("replaces a map with a scalar and a scalar with a map, as helm does", () => {
    expect(parseValues(computedYaml("a:\n  b: 1\nc: 2\n", "a: off\nc:\n  d: 3\n"))).toEqual({ a: "off", c: { d: 3 } });
  });

  it("writes into a chart's flow {} or [] in block style, and leaves an untouched one alone", () => {
    const computed = computedYaml("affinity: {}\ntolerations: []\nflags: [a]\n", "affinity:\n  nodeAffinity:\n    terms:\n      - values: [x]\ntolerations:\n  - key: gpu\n");
    expect(computed).toBe("affinity:\n  nodeAffinity:\n    terms:\n      - values:\n          - x\ntolerations:\n  - key: gpu\nflags: [ a ]\n");
  });

  it("builds on a chart with no values", () => {
    expect(computedYaml("", "")).toBe("");
    expect(parseValues(computedYaml("", "a: 1\n"))).toEqual({ a: 1 });
  });

  it("keeps only what changed, merged into the overrides already there", () => {
    const base = parseValues(computedYaml(defaults, overrides));
    const final = structuredClone(base) as Record<string, any>;
    final.image.tag = "custom";
    final.flags = ["--new"];
    delete final.replicaCount;
    final.added = { on: true };
    const edit = overrideEdit(base, { probe: { port: null }, image: { pullPolicy: "Always" } }, final);
    expect(edit.edits).toEqual({
      probe: { port: null }, image: { pullPolicy: "Always", tag: "custom" },
      flags: ["--new"], replicaCount: null, added: { on: true },
    });
    expect(edit.changes).toBe(4);
  });

  it("changes nothing for a final it was not asked to change", () => {
    const base = parseValues(computedYaml(defaults, overrides));
    expect(overrideEdit(base, { a: 1 }, structuredClone(base))).toEqual({ edits: { a: 1 }, changes: 0 });
  });

  it("lists the overridden paths, and none for invalid YAML", () => {
    expect(overridePaths("")).toEqual([]);
    expect(overridePaths("a: 1\nb:\n  c: 2\n")).toEqual(["a", "b.c"]);
    expect(overridePaths("a: [")).toBeUndefined();
  });

  it("reads an empty document as no values", () => {
    expect(parseValues("")).toEqual({});
    expect(parseValues("# nothing\n")).toEqual({});
  });

  it.each(["[]", "a: [", "a: 1\na: 2", "a: 1\n---\nb: 2", "!!set { a: null }", "a: !!set { b: null }", "a: .nan", "a: .inf", "a: &loop { recursive: *loop }"])("rejects invalid or non-mapping YAML: %s", (text) => {
    expect(() => parseValues(text)).toThrow();
  });
});

describe("keyLines", () => {
  it("finds every key's line, list items by index", () => {
    expect(keyLines("# top\nimage:\n  tag: v1\nlist:\n  - name: a\n  - name: b\n")).toEqual([
      { path: "image", line: 1 }, { path: "image.tag", line: 2 }, { path: "list", line: 3 },
      { path: "list[0].name", line: 4 }, { path: "list[1].name", line: 5 },
    ]);
  });

  it("keeps the keys before a syntax error", () => {
    expect(keyLines("a: 1\nb: [\n").map((k) => k.path)).toContain("a");
  });
});

describe("searchKeys", () => {
  const keys = keyLines("image:\n  tag: v1\nsidecar:\n  image:\n    tag: v2\ntagline: x\n");
  it("ranks a key named the query, then a path starting with it, then one containing it", () => {
    expect(searchKeys(keys, "Tag").map((k) => k.path)).toEqual(["image.tag", "sidecar.image.tag", "tagline"]);
    expect(searchKeys(keys, "image").map((k) => k.path)).toEqual(["image", "sidecar.image", "image.tag", "sidecar.image.tag"]);
    expect(searchKeys(keys, "  ")).toEqual([]);
  });
});

describe("readYaml", () => {
  it("reads values and keys in one parse, and keeps the keys when the values fail", () => {
    expect(readYaml("a:\n  b: 1\n")).toEqual({ values: { a: { b: 1 } }, keys: [{ path: "a", line: 0 }, { path: "a.b", line: 1 }] });
    const dup = readYaml("a: 1\na: 2\n");
    expect(dup.values).toBeUndefined();
    expect(dup.error).toBeTruthy();
    expect(dup.keys.map((k) => k.path)).toEqual(["a", "a"]);
  });
});

describe("mergeValues", () => {
  it("lays the overrides over swissd's layers, keeping a null for helm", () => {
    const layers = parseValues("replicaCount: 2\nimage:\n  tag: catalog\nprobe:\n  port: 8000\n");
    expect(mergeValues(layers, { image: { pullPolicy: "Always" }, probe: { port: null }, flags: ["--x"] })).toEqual({
      replicaCount: 2, image: { tag: "catalog", pullPolicy: "Always" }, probe: { port: null }, flags: ["--x"],
    });
  });
});
