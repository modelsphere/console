import { describe, expect, it } from "vitest";
import { fromYamlObject } from "./yaml";

describe("fromYamlObject", () => {
  it("treats empty, comment-only and null documents as no overrides", () => {
    expect(fromYamlObject("")).toBeUndefined();
    expect(fromYamlObject("# temporarily disabled")).toBeUndefined();
    expect(fromYamlObject("null")).toBeUndefined();
  });

  it("accepts a plain object and copies it", () => {
    expect(
      fromYamlObject("image:\n  repository: mock\nreplicas: 2"),
    ).toEqual({ image: { repository: "mock" }, replicas: 2 });
  });

  it("rejects scalars, arrays and non-finite numbers", () => {
    expect(() => fromYamlObject("just-a-string")).toThrow();
    expect(() => fromYamlObject("- one\n- two")).toThrow();
    expect(() => fromYamlObject(".inf")).toThrow();
  });

  it("rejects recursive aliases before they can reach toYaml", () => {
    expect(() => fromYamlObject("a: &x\n  b: *x")).toThrow(/recursive alias/);
  });

  it("keeps YAML timestamps as strings", () => {
    expect(fromYamlObject("when: 2026-10-20")).toEqual({ when: "2026-10-20" });
  });
});
