import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mergeEditLayerYAML } from "./edit-layer";

describe("mergeEditLayerYAML", () => {
  const editLayer = { modelRoute: { slo: { enabled: true, name: "prod/slo" } } };

  it("injects the inherited edit layer when user edits are empty", () => {
    const out = mergeEditLayerYAML("", editLayer);
    expect(parse(out!)).toEqual(editLayer);
  });

  it("preserves unrelated user edits while enforcing the inherited SLO key", () => {
    const user = "extraArgs:\n  - --foo\nmodelRoute:\n  slo:\n    enabled: false\n  timeout: 30s\n";
    const out = mergeEditLayerYAML(user, editLayer);
    expect(parse(out!)).toEqual({
      extraArgs: ["--foo"],
      modelRoute: {
        slo: { enabled: true, name: "prod/slo" },
        timeout: "30s",
      },
    });
  });

  it("returns undefined when both edits and editLayer are empty", () => {
    expect(mergeEditLayerYAML("  ", undefined)).toBeUndefined();
  });
});
