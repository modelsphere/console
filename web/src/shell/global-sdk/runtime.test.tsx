import { describe, expect, it } from "vitest";
import { createRegistration } from "@/shell/global-sdk/runtime";
import { menuLandingPath } from "@/shell/global-sdk/navigation";
import { navGroups, validateModules } from "@/shell/module";

const Page = () => null;

function registration() {
  const runtime = createRegistration();
  runtime.begin({ id: "example", entry: "/plugins/example/index.js" });
  return runtime;
}

describe("SDK menu adaptation", () => {
  it("chooses a permitted default by order without confusing it with the complete menu list", () => {
    const menus = [
      { name: "hidden", path: "/example/hidden", hidden: true, order: 1 },
      { name: "denied", path: "/example/denied", authKey: "denied", order: 2 },
      { name: "contributed", path: "/example/contributed", parent: "other", order: 3 },
      { name: "fallback", path: "/example/fallback", order: 200 },
      { name: "first", path: "/example/first", authKey: "allowed", order: 100 },
    ];
    expect(menuLandingPath(menus, permission => permission === "allowed")).toBe("/example/first");
    expect(menuLandingPath(menus, () => false)).toBe("/example/fallback");
    expect(menus).toHaveLength(5);
    expect(menuLandingPath(menus.slice(0, 3), () => false)).toBeUndefined();
  });
  it("preserves every menu independently of detail routes", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "list", path: "/example", title: "列表" },
      { name: "pricing", path: "/example/pricing", title: "价格" },
    ] });
    runtime.sdk.registerPluginComponent("example", "List", Page);
    runtime.sdk.registerPluginComponent("example", "Pricing", Page);
    runtime.sdk.registerPluginRoutes("example", { "items/[id]": Page });
    const module = runtime.finish();
    expect(module.pages.map(page => page.path)).toEqual(["", "pricing", "items/:id"]);
    expect(navGroups([module], () => true)[1].items.map(item => item.to)).toEqual(["/example", "/example/pricing"]);
  });

  it("keeps hidden menu routes and maps authKey to both navigation and route permission", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "list", path: "/example", hidden: true },
      { name: "pricing", path: "/example/pricing", authKey: "example.pricing.view" },
    ] });
    runtime.sdk.registerPluginComponent("example", "List", Page);
    runtime.sdk.registerPluginComponent("example", "Pricing", Page);
    const module = runtime.finish();
    expect(module.pages.map(page => page.path)).toEqual(["", "pricing"]);
    expect(module.pages[1].permission).toBe("example.pricing.view");
    expect(navGroups([module], () => false)).toHaveLength(1);
    expect(navGroups([module], () => true)[1].items.map(item => item.to)).toEqual(["/example/pricing"]);
  });

  it("accepts Global namespaced paths and PascalCase component mapping", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "gpu-assign", path: "/rise.io/v1/example/assign", scope: "platform" },
      { name: "prices", path: "/rise.io/v1/example/prices", scope: "platform" },
    ] });
    runtime.sdk.registerPluginComponent("example", "GpuAssign", Page);
    runtime.sdk.registerPluginComponent("example", "Prices", Page);
    runtime.sdk.registerPluginRoutes("example", { "assign/[id]/details": Page });
    const module = runtime.finish();
    expect(module.basePath).toBe("/rise.io/v1/example");
    expect(() => validateModules([module])).not.toThrow();
    expect(module.pages.map(page => page.path)).toContain("assign/:id/details");
    expect(navGroups([module], () => true)[1].items.map(item => item.to)).toEqual([
      "/rise.io/v1/example/assign", "/rise.io/v1/example/prices",
    ]);
  });

  it("merges a menu and its explicit route into one guarded page", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "home", path: "/example", authKey: "example.view" },
      { name: "pricing", path: "/example/pricing", authKey: "example.pricing.view" },
    ] });
    runtime.sdk.registerPluginRoutes("example", { "/example": Page, pricing: Page });
    const module = runtime.finish();
    expect(module.pages).toHaveLength(2);
    expect(module.pages[1]).toMatchObject({ path: "pricing", permission: "example.pricing.view" });
  });

  it("inherits the nearest menu permission on non-menu detail routes", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "home", path: "/example", authKey: "example.view" },
      { name: "jobs", path: "/example/jobs", authKey: "example.jobs.view" },
    ] });
    runtime.sdk.registerPluginComponent("example", "Home", Page);
    runtime.sdk.registerPluginComponent("example", "Jobs", Page);
    runtime.sdk.registerPluginRoutes("example", { "jobs/[id]": Page, "other/[id]": Page });
    expect(runtime.finish().pages.map(page => [page.path, page.permission])).toEqual([
      ["", "example.view"], ["jobs", "example.jobs.view"],
      ["jobs/:id", "example.jobs.view"], ["other/:id", "example.view"],
    ]);
  });

  it("accepts absolute namespaced detail routes without duplicating their prefix", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "list", path: "/rise.io/v1/example/list" }] });
    runtime.sdk.registerPluginComponent("example", "List", Page);
    runtime.sdk.registerPluginRoutes("example", { "/rise.io/v1/example/list/[id]": Page });
    expect(runtime.finish().pages.map(page => page.path)).toEqual(["", "list", "list/:id"]);
  });

  it("keeps the Global three-segment namespace independent of nested menu locations", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "gpu-2d", path: "/rise.io/v1/example/jobs/list" },
      { name: "pricing", path: "/rise.io/v1/example/jobs/pricing" },
    ] });
    runtime.sdk.registerPluginComponent("example", "Gpu2d", Page);
    runtime.sdk.registerPluginComponent("example", "Pricing", Page);
    runtime.sdk.registerPluginRoutes("example", { "jobs/[id]/details": Page });
    const module = runtime.finish();
    expect(module.basePath).toBe("/rise.io/v1/example");
    expect(module.pages.map(page => page.path)).toEqual(["", "jobs/list", "jobs/pricing", "jobs/:id/details"]);
    expect(navGroups([module], () => true)[1].items[0].key).toBe("gpu2d");
  });

  it("matches hidden dynamic menus against normalized route declarations", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "detail", path: "/example/jobs/[id]", hidden: true, authKey: "example.jobs.view" },
    ] });
    runtime.sdk.registerPluginRoutes("example", { "jobs/[id]": Page });
    const module = runtime.finish();
    expect(module.pages).toHaveLength(2);
    expect(module.pages[1]).toMatchObject({ path: "jobs/:id", permission: "example.jobs.view" });
    expect(navGroups([module], () => true)).toHaveLength(1);
  });

  it("rejects ambiguous menu identities and normalized route collisions", () => {
    const duplicate = registration();
    duplicate.sdk.registerPlugin({ name: "example", version: "1", menus: [
      { name: "home", path: "/example" }, { name: "home", path: "/example/other" },
    ] });
    duplicate.sdk.registerPluginComponent("example", "Home", Page);
    expect(() => duplicate.finish()).toThrow(/menu name declared twice/);

    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "home", path: "/example" }] });
    runtime.sdk.registerPluginComponent("example", "Home", Page);
    runtime.sdk.registerPluginRoutes("example", { "items/[id]": Page, "items/:id": Page });
    expect(() => runtime.finish()).toThrow(/declared twice/);
  });

  it.each([
    ["scope", { scope: "project" }],
    ["requiredScope", { requiredScope: ["project"] }],
  ])("rejects unsupported %s explicitly instead of silently changing its meaning", (field, extra) => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "Example", path: "/example", ...extra }] });
    runtime.sdk.registerPluginComponent("example", "Example", Page);
    expect(() => runtime.finish()).toThrow(new RegExp(field));
  });

  it.each(["/example?tab=jobs", "/example#jobs", "/example/../other"])("rejects unsupported or unsafe path %s", path => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "Example", path }] });
    runtime.sdk.registerPluginComponent("example", "Example", Page);
    expect(() => runtime.finish()).toThrow(/Unsupported SDK route/);
  });

  it("rejects inherited object properties as icon names", () => {
    const runtime = registration();
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [{ name: "Example", path: "/example", icon: "constructor" }] });
    runtime.sdk.registerPluginComponent("example", "Example", Page);
    expect(() => runtime.finish()).toThrow(/Unsupported menu icon/);
  });
});
