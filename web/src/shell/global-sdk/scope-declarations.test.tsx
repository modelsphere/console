import { describe, expect, it } from "vitest";
import { createRegistration } from "./runtime";
import type { Definition } from "./navigation";

function compile(scopes: Definition["scopes"]) {
  const runtime = createRegistration();
  runtime.begin({ id: "example", entry: "/plugins/example/index.js" });
  runtime.sdk.registerPlugin({ name: "example", version: "1", displayName: "Example", icon: "boxes", scopes, menus: [
    { name: "home", path: "/example/home" },
    { name: "reports", path: "/billing/reports", hidden: true },
  ] });
  runtime.sdk.registerPluginComponent("example", "Home", () => null);
  runtime.sdk.registerPluginComponent("example", "Reports", () => null);
  return runtime.finish();
}

describe("scope declaration adaptation", () => {
  it("preserves scope labels, icons and registered landing paths", () => {
    const module = compile([{ scope: "platform", title: "Reports", icon: "activity", path: "/billing/reports", category: "Tools" }]);
    expect(module.navigation!.scopes).toMatchObject([{ scope: "platform", title: "Reports", path: "/billing/reports" }]);
    expect(module.navigation!.scopes![0].icon).toBeTypeOf("object");
  });

  it("keeps declarations independent from Global viewport modes", () => {
    expect(compile([{ scope: "platform", viewport: "boss" }]).navigation!.scopes?.[0].title).toBe("Example");
    expect(compile([{ scope: "platform", viewport: "console" }]).navigation!.scopes).toHaveLength(1);
    expect(compile(undefined).navigation!.scopes).toEqual([]);
    expect(compile([]).navigation!.scopes).toEqual([]);
  });

  it("does not infer scopes for contributed-only plugins", () => {
    const runtime = createRegistration();
    runtime.begin({ id: "example", entry: "/plugins/example/index.js" });
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "home", path: "/example/home", parent: "another" }] });
    runtime.sdk.registerPluginComponent("example", "Home", () => null);
    expect(runtime.finish().navigation!.scopes).toEqual([]);
  });

  it.each(["/outside", "//example.com", "/example/home?tab=1", "/example/home#x", "/example/:id"])("rejects invalid landing %s", path => {
    expect(() => compile([{ scope: "platform", path }])).toThrow(/application|route/i);
  });

  it("rejects duplicate scopes, malformed labels and unknown icons", () => {
    expect(() => compile([{ scope: "platform" }, { scope: "platform" }])).toThrow(/duplicate/i);
    expect(() => compile([{ scope: "platform", title: 42 } as never])).toThrow(/title/i);
    expect(() => compile([{ scope: "platform", icon: "no-such-icon" }])).toThrow(/icon/i);
    expect(() => compile([{ scope: "workspace" }])).toThrow(/scope/i);
  });

  it("accepts the current cluster application without reproducing Global viewport policy", () => {
    expect(compile([{ scope: "cluster", viewport: "boss" }]).navigation!.scopes).toMatchObject([{ scope: "cluster" }]);
  });
});
