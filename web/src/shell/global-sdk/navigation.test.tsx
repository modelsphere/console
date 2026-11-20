import { describe, expect, it } from "vitest";
import { createRegistration } from "./runtime";
import { menuLandingPath, type Definition } from "./navigation";
import { activeNavItem, joinPath, navGroups, validateModules, type ConsoleModule } from "@/shell/module";

const Page = () => null;

function compile(menus: Definition["menus"], routes: string[] = []): ConsoleModule {
  const runtime = createRegistration();
  runtime.begin({ id: "example", entry: "/plugins/example/index.js" });
  runtime.sdk.registerPlugin({ name: "example", version: "1", menus });
  const registered = new Set<string>();
  const registerMenus = (items: NonNullable<Definition["menus"]>) => {
    for (const menu of items) {
      if (!registered.has(menu.name)) runtime.sdk.registerPluginComponent("example", menu.name, Page);
      registered.add(menu.name);
      registerMenus(menu.children ?? []);
    }
  };
  registerMenus(menus ?? []);
  runtime.sdk.registerPluginRoutes("example", Object.fromEntries(routes.map(path => [path, Page])));
  return runtime.finish();
}

const tree: NonNullable<Definition["menus"]> = [{
  name: "tools", path: "/example/tools", title: "Tools", authKey: "tools.view", children: [
    { name: "jobs", path: "/example/tools/jobs", title: "Jobs", order: 20, children: [
      { name: "runs", path: "/example/tools/jobs/runs", title: "Runs" },
    ] },
    { name: "settings", path: "/example/settings", title: "Settings", order: 0 },
    { name: "secret", path: "/example/secret", hidden: true },
  ],
}];

describe("platform menu compatibility", () => {
  it("keeps arbitrary-depth children as a sorted navigation tree and registers all routes", () => {
    const module = compile(tree);
    expect(module.pages.map(page => page.path)).toEqual(["", "tools", "tools/jobs", "tools/jobs/runs", "settings", "secret"]);
    expect(module.pages.find(page => page.path === "settings")?.permission).toBe("tools.view");
    const groups = navGroups([module], () => true);
    expect(groups[1].items.map(item => item.label)).toEqual(["Tools"]);
    expect(groups[1].items[0].children?.map(item => item.label)).toEqual(["Settings", "Jobs"]);
    expect(groups[1].items[0].children?.[1].children?.[0].label).toBe("Runs");
    expect(activeNavItem(groups[1].items, "/example/tools/jobs/runs/42")?.label).toBe("Runs");
    expect(navGroups([module], () => false)).toHaveLength(1);
  });

  it("preserves routes but hides the complete navigation subtree of a hidden ancestor", () => {
    const module = compile([{ ...tree[0], hidden: true }]);
    expect(module.pages.some(page => page.path === "tools/jobs/runs")).toBe(true);
    expect(navGroups([module], () => true)).toHaveLength(1);
    expect(menuLandingPath([{ ...tree[0], hidden: true }], () => true)).toBeUndefined();
  });

  it("inherits sidebar ownership but permits explicit child contributions", () => {
    const module = compile([{ ...tree[0], parent: "target", children: [
      { name: "jobs", path: "/example/jobs", title: "Jobs" },
      { name: "elsewhere", path: "/other/elsewhere", title: "Elsewhere", parent: "second" },
    ] }]);
    const target: ConsoleModule = { id: "target", title: "Target", basePath: "/target", pages: [] };
    const second: ConsoleModule = { id: "second", title: "Second", basePath: "/second", pages: [] };
    const groups = navGroups([target, second, module], () => true);
    expect(groups[1].items[0].children?.[0].label).toBe("Jobs");
    expect(groups[2].items[0].label).toBe("Elsewhere");
  });

  it.each(["activity", "settings", "bar-chart-2", "gpu", "network"])("accepts the Lucide catalog icon %s", icon => {
    expect(() => compile([{ name: "home", path: "/example", icon }])).not.toThrow();
  });

  it("rejects unknown icons and inherited object keys", () => {
    for (const icon of ["constructor", "__proto__", "not-an-existing-lucide-icon"]) {
      expect(() => compile([{ name: "home", path: "/example", icon }])).toThrow(/icon/);
    }
  });

  it("supports separate namespaces without rewriting menu URLs or duplicating plugin identity", () => {
    const module = compile([
      { name: "jobs", path: "/rise.io/v1/jobs/list", authKey: "jobs.view" },
      { name: "prices", path: "/billing.io/v1/prices/list", authKey: "prices.view" },
    ], ["list/[id]", "/billing.io/v1/prices/list/[id]"]);
    expect(() => validateModules([module])).not.toThrow();
    const urls = module.pages.map(page => joinPath(page.basePath ?? module.basePath, page.path));
    expect(urls).toContain("/rise.io/v1/jobs/list/:id");
    expect(urls).toContain("/billing.io/v1/prices/list/:id");
    expect(module.pages.find(page => page.basePath === "/billing.io/v1/prices" && page.path === "list/:id")?.permission).toBe("prices.view");
    expect(navGroups([module], () => true)[1].items.map(item => item.to)).toEqual([
      "/rise.io/v1/jobs/list", "/billing.io/v1/prices/list",
    ]);
  });

  it("validates secondary namespaces against reserved paths and other modules", () => {
    const builtin: ConsoleModule = { id: "core", title: "Core", basePath: "/core", pages: [] };
    expect(() => validateModules([builtin, compile([
      { name: "home", path: "/example" }, { name: "collision", path: "/core/list" },
    ])])).toThrow(/already taken|overlap/);
    expect(() => validateModules([compile([
      { name: "home", path: "/example" }, { name: "reserved", path: "/api/list" },
    ])])).toThrow(/reserved/);
  });

  it("rejects duplicates and unsupported scopes anywhere in the tree", () => {
    expect(() => compile([{ ...tree[0], children: [{ name: "tools", path: "/other" }] }])).toThrow(/name declared twice/);
    expect(() => compile([{ ...tree[0], children: [{ name: "other", path: "/example/tools" }] }])).toThrow(/path declared twice/);
    expect(() => compile([{ ...tree[0], children: [{ name: "other", path: "/other", scope: "project" }] }])).toThrow(/scope/);
  });

  it("selects ordered static landings without redirecting to unresolved parameters", () => {
    expect(menuLandingPath([
      { name: "detail", path: "/example/[id]", order: 0 },
      { name: "default", path: "/example/default", order: 100 },
      { name: "first", path: "/example/first", order: 0 },
    ], () => true)).toBe("/example/first");
  });

  it("compares landing order only among siblings, not between children and unrelated roots", () => {
    expect(menuLandingPath([
      { name: "later", path: "/example/later", order: 100, children: [
        { name: "child", path: "/example/later/child", order: 0 },
      ] },
      { name: "first", path: "/example/first", order: 1 },
    ], () => true)).toBe("/example/first");
  });

  it("keeps relative and in-namespace absolute routes in their declared module context", () => {
    const module = compile([{ name: "home", path: "/example" }], ["v1/jobs", "/example/v1/other"]);
    expect(module.pages.find(page => page.path === "v1/jobs")).toMatchObject({ path: "v1/jobs" });
    expect(module.pages.find(page => page.path === "v1/jobs")?.basePath).toBeUndefined();
    expect(module.pages.find(page => page.path === "v1/other")?.basePath).toBeUndefined();
  });

  it("selects landings within each namespace and respects denied tree ancestors", () => {
    const menus = [
      { name: "tools", path: "/example/tools", authKey: "denied", children: [
        { name: "child", path: "/billing/child", authKey: "allowed", order: 0 },
      ] },
      { name: "prices", path: "/billing/prices", authKey: "allowed", order: 100 },
    ];
    expect(menuLandingPath(menus, permission => permission === "allowed", "/example")).toBeUndefined();
    expect(menuLandingPath(menus, permission => permission === "allowed", "/billing")).toBe("/billing/prices");
  });

  it("retains explicit child permission overrides on that child's detail routes", () => {
    const module = compile([{ ...tree[0], children: [
      { name: "child", path: "/billing/child", authKey: "child.view" },
    ] }], ["/billing/child/[id]"]);
    expect(module.pages.find(page => page.path === "child/:id")?.permission).toBe("child.view");
    expect(navGroups([module], permission => permission === "child.view")).toHaveLength(1);
  });

  it("reports cyclic declarations instead of overflowing the registration stack", () => {
    const menu = { name: "cyclic", path: "/example", children: [] as NonNullable<Definition["menus"]> };
    menu.children.push(menu);
    const runtime = createRegistration();
    runtime.begin({ id: "example", entry: "/plugins/example/index.js" });
    runtime.sdk.registerPlugin({ name: "example", version: "1", menus: [menu] });
    expect(() => runtime.finish()).toThrow(/Cyclic children/);
  });
});
