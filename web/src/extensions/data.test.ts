import { describe, expect, it } from "vitest";
import { dataForPlugin } from "./data";

describe("dataForPlugin", () => {
  it("keeps same-named data extensions apart per plugin", () => {
    const registered = [
      { plugin: "alpha", id: "owner" },
      { plugin: "beta", id: "owner" },
    ];
    const values = ["alpha-owner", "beta-owner"];
    expect(dataForPlugin(registered, values, "alpha")).toEqual({ owner: "alpha-owner" });
    expect(dataForPlugin(registered, values, "beta")).toEqual({ owner: "beta-owner" });
  });

  it("omits extensions another plugin owns", () => {
    const registered = [{ plugin: "alpha", id: "owner" }];
    expect(dataForPlugin(registered, [{ name: "alpha" }], "beta")).toEqual({});
  });
});
