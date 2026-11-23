import { Boxes } from "lucide-react";
import { describe, expect, it } from "vitest";
import { activeApplication } from "./applications";
import { applicationNavigation } from "./application-navigation";
import { pagePath, type ConsoleModule } from "./module";
import { availableModules } from "./capabilities";

function application(): ConsoleModule {
  const module: ConsoleModule = {
    id: "example", title: "Example", basePath: "/example",
    pages: [
      { path: "", element: null },
      { path: "hidden", element: null, menu: { label: "Hidden", icon: Boxes, hidden: true, order: 0 } },
      { path: "private", element: null, permission: "private.view", menu: { label: "Private", icon: Boxes, order: 1 } },
      { path: "public", element: null, menu: { label: "Public", icon: Boxes, order: 2 } },
      { path: "public/:id", element: null },
    ],
  };
  return declare(module);
}

function declare(module: ConsoleModule): ConsoleModule {
  const entries = module.pages.filter(page => page.menu).map(page => ({ name: page.path, path: pagePath(module, page) }));
  return { ...module, navigation: {
    provider: "test/example", entries, menus: [], scopes: [{ scope: "platform", title: "Tools", icon: Boxes }],
    composition: { groups: [{ name: "tools", title: "", menus: entries.map(entry => ({ provider: "test/example", entry: entry.name })) }] },
  } };
}
const items = (modules: ConsoleModule[], has: (permission: string) => boolean) => applicationNavigation(modules, has, "/").applications.filter(item => item.id !== "console");

describe("composition application targets", () => {
  it("uses the first visible permitted static reference, not a synthetic index or detail route", () => {
    expect(items([application()], () => false)).toMatchObject([{ id: "example/platform", to: "/example/public", label: "Tools" }]);
    expect(items([application()], () => true)[0].to).toBe("/example/private");
  });

  it("prefers a declared landing and falls back when it becomes inaccessible", () => {
    const module = application();
    module.navigation!.scopes[0].path = "/example/private";
    expect(items([module], () => true)[0].to).toBe("/example/private");
    expect(items([module], () => false)[0].to).toBe("/example/public");
  });

  it("does not generate applications from provider scopes alone or inaccessible references", () => {
    const module = application();
    expect(items([{ ...module, navigation: { ...module.navigation!, composition: undefined } }], () => true)).toEqual([]);
    expect(items([{ ...module, pages: [] }], () => true)).toEqual([]);
    module.pages = module.pages.filter(page => page.permission);
    expect(items([module], () => false)).toEqual([]);
  });

  it("uses alternate namespaces while preserving denied-ancestor checks", () => {
    const module = declare({ ...application(), pages: [
      { path: "parent", element: null, permission: "denied", menu: { label: "Parent", icon: Boxes } },
      { path: "child", basePath: "/other", element: null, menu: { label: "Child", icon: Boxes, treeParent: "/example/parent" } },
      { path: "reports", basePath: "/billing", element: null, menu: { label: "Reports", icon: Boxes } },
    ] });
    module.navigation!.scopes[0].path = "/other/child";
    expect(items([module], () => false)[0].to).toBe("/billing/reports");
  });

  it("uses composition reference order instead of a provider's default menu order", () => {
    const module = declare({ ...application(), pages: [
      { path: ":id", element: null, menu: { label: "Detail", icon: Boxes, order: 0 } },
      { path: "later", element: null, menu: { label: "Later", icon: Boxes, order: 100 } },
      { path: "first", element: null, menu: { label: "First", icon: Boxes, order: 1 } },
    ] });
    expect(items([module], () => true)[0].to).toBe("/example/later");
    module.navigation!.composition!.groups[0].menus.reverse();
    expect(items([module], () => true)[0].to).toBe("/example/first");
  });

  it("respects backend capability filtering before selecting an application target", () => {
    const module = { ...application(), capability: "example" };
    const targets = (configured: boolean, canRead: boolean, canWrite: boolean) => items(availableModules([module], {
      example: { configured, canRead, canWrite },
    }), () => true);
    expect(targets(false, true, true)).toEqual([]);
    expect(targets(true, false, true)).toEqual([]);
    module.pages.find(page => page.path === "private")!.requiresWrite = true;
    expect(targets(true, true, false)[0].to).toBe("/example/public");
  });

  it("keeps application landing pages and route ownership within their declared context", () => {
    const module = application();
    module.pages[2].menu!.scope = "cluster";
    module.navigation!.scopes.push({ scope: "cluster", title: "Cluster", icon: Boxes });
    const targets = items([module], () => true);
    expect(targets).toMatchObject([
      { scope: "cluster", to: "/example/private" },
      { scope: "platform", to: "/example/public" },
    ]);
    expect(activeApplication(targets, "/example/private/42")).toBe("example/cluster");
    expect(activeApplication(targets, "/example/public/42")).toBe("example/platform");
    expect(targets[0].paths).not.toContain("/example/public/:id");
    expect(targets[1].paths).not.toContain("/example/private");
  });
});
