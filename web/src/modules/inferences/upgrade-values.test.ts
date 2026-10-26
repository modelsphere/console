import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { UpgradeValuesError, upgradeEditsYAML } from "./upgrade-values";

const baseline = `image:
  repository: example/engine
  tag: v1
resources:
  limits:
    cpu: "4"
    memory: 16Gi
extraArgs:
  - --model-path=/models/model
  - --port=8000
replicaCount: 2
labels: {}
`;

describe("editing the current upgrade values", () => {
  it("does not turn displayed chart defaults into overrides when untouched", () => {
    expect(parse(upgradeEditsYAML(baseline, baseline))).toEqual({});
  });

  it("keeps existing advanced overrides when the current values are unchanged", () => {
    const previous = { readinessProbe: { periodSeconds: 60 }, annotations: { "example.com/owner": "team" } };
    expect(parse(upgradeEditsYAML(baseline, baseline, previous))).toEqual(previous);
  });

  it("sends only a changed nested resource limit, leaving image and catalog defaults free to update", () => {
    const edited = baseline.replace('cpu: "4"', 'cpu: "6"');
    const result = parse(upgradeEditsYAML(baseline, edited));
    expect(result).toEqual({ resources: { limits: { cpu: "6" } } });
    expect(result).not.toHaveProperty("image");
    expect(result).not.toHaveProperty("replicaCount");
  });

  it("replaces changed argument lists as a whole", () => {
    const result = parse(upgradeEditsYAML(baseline, baseline.replace("--port=8000", "--port=9000")));
    expect(result).toEqual({ extraArgs: ["--model-path=/models/model", "--port=9000"] });
  });

  it("treats formatting and key ordering changes as no semantic changes", () => {
    const before = 'a: 1\nb: true\nc: "yes"\n';
    const edited = 'c: yes\nb: true # retain\na: 1\n';
    expect(parse(upgradeEditsYAML(before, edited))).toEqual({});
  });

  it("keeps scalar types, quoted keys and integers beyond JavaScript precision", () => {
    const result = upgradeEditsYAML('"a:b": "false"\ncount: 9007199254740993\n', '"a:b": "true"\ncount: 9007199254740994\n');
    expect(parse(result, { intAsBigInt: true })).toEqual({ "a:b": "true", count: 9007199254740994n });
  });

  it("emits null for removed keys and preserves explicit empty lists", () => {
    expect(parse(upgradeEditsYAML("a: 1\nb: [1]\n", "b: []\n"))).toEqual({ a: null, b: [] });
  });

  it("merges new edits over prior advanced overrides without modifying the source", () => {
    const previous = { resources: { limits: { memory: "16Gi" } }, custom: { value: 1 } };
    const result = parse(upgradeEditsYAML(baseline, baseline.replace('cpu: "4"', 'cpu: "6"'), previous));
    expect(result).toEqual({ resources: { limits: { memory: "16Gi", cpu: "6" } }, custom: { value: 1 } });
    expect(previous).toEqual({ resources: { limits: { memory: "16Gi" } }, custom: { value: 1 } });
  });

  it.each(["[1, 2]", "", "null", "a: 1\na: 2", "a: [", "a: 1\n---\na: 2", "? [a, b]\n: value", "a: .inf", "a: &loop [*loop]"])("rejects invalid or unsupported value documents: %s", (text) => {
    expect(() => upgradeEditsYAML("a: 1\n", text)).toThrow(UpgradeValuesError);
  });

  it("bounds input size before parsing", () => {
    expect(() => upgradeEditsYAML("a: 1", `a: ${"x".repeat(1 << 20)}`)).toThrow(UpgradeValuesError);
  });
});
