import { describe, expect, it } from "vitest";
import { fixtureCanaries } from "../fixtures/canaries";
import { validateCanary } from "./validate";

describe("generated resource names", () => {
  it.each([["a", "a-cart"], ["a", "openresty-a"], ["openresty", "b"]])(
    "rejects colliding names %s and %s",
    (first, second) => {
      const cr = structuredClone(fixtureCanaries[0]);
      cr.spec.arms = cr.spec.arms.slice(0, 2);
      cr.spec.arms[0].name = first;
      cr.spec.arms[1].name = second;
      expect(validateCanary(cr).some(issue => issue.message.includes("generated object name"))).toBe(true);
    },
  );

  it("allows names that only share a prefix", () => {
    const cr = structuredClone(fixtureCanaries[0]);
    cr.spec.arms = cr.spec.arms.slice(0, 2);
    cr.spec.arms[0].name = "a";
    cr.spec.arms[1].name = "a-b";
    expect(validateCanary(cr)).toEqual([]);
  });
});
