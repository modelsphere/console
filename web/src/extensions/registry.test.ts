import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateResourceAction, extensions } from "./registry";

afterEach(() => { extensions.actions.length = 0; });

describe("resource action data", () => {
  it("supplies only the owning plugin's loaded data to its action", () => {
    const evaluate = vi.fn(({ data }) => data.policy?.canEdit ? false : "locked");
    extensions.actions.push({ plugin: "alpha", id: "slo", resourceType: "service", action: "slo", evaluate });
    const loaded = {
      extensions: [{ plugin: "beta", id: "policy" }, { plugin: "alpha", id: "policy" }],
      values: [{ canEdit: false }, { canEdit: true }],
    };
    expect(evaluateResourceAction("service", "ns/name", {}, "slo", loaded)).toBe(false);
    expect(evaluate.mock.calls[0][0].data).toEqual({ policy: { canEdit: true } });
  });

  it("keeps an unresolved policy unavailable rather than borrowing another plugin's result", () => {
    extensions.actions.push({
      plugin: "alpha", id: "slo", resourceType: "service", action: "slo",
      evaluate: ({ data }) => data.policy ? false : "unavailable",
    });
    expect(evaluateResourceAction("service", "ns/name", {}, "slo", {
      extensions: [{ plugin: "beta", id: "policy" }], values: [{ canEdit: true }],
    })).toBe("unavailable");
  });
});
