import { Boxes } from "lucide-react";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { createRegistration } from "./global-sdk/runtime";
import { applicationNavigation } from "./application-navigation";
import { flattenNavItems, type ConsoleModule, validateModules } from "./module";
import type { NavigationComposition } from "./global-sdk/composition";
import { menuLandingPath, type SDKMenu } from "./global-sdk/navigation";
import { resolveUserMenuItems } from "./user-menu";

const builtin: ConsoleModule = { id: "iam", title: "IAM", basePath: "/iam", pages: [
  { path: "users", element: null, permission: "users.view", menu: { label: "Users", icon: Boxes } },
  { path: "users/:id", element: null, permission: "users.view" },
] };
const composition: NavigationComposition = {
  name: "operations", version: "1", displayName: "Operations", scopes: [{ scope: "cluster", title: "Operations" }],
  groups: [{ name: "resources", title: "Resources", menus: [
    { provider: "example.io/resources", entry: "pods" },
    { provider: "console/iam", entry: "users" },
  ] }],
};

function install(includeComposition = true) {
  const runtime = createRegistration();
  const modules: ConsoleModule[] = [builtin];
  const add = (id: string, register: () => void) => {
    runtime.begin({ id, group: "example.io", entry: `/plugins/${id}/entry.js` });
    register();
    modules.push(runtime.finish());
    runtime.commit();
    runtime.end();
  };
  add("canary", () => {
    runtime.sdk.registerPlugin({ name: "canary", version: "1", scopes: [{ scope: "platform", title: "Canary" }],
      menus: [{ name: "experiments", path: "/canary", title: "Experiments", scope: "platform" }] });
    runtime.sdk.registerPluginRoutes("canary", { "/canary": () => null, "/canary/:id": () => null });
  });
  add("resources", () => {
    runtime.sdk.registerPlugin({ name: "resources", version: "1", scopes: [{ scope: "cluster" }], entries: [
      { name: "pods", path: "/resources/pods", title: "Pods", scope: "cluster", authKey: "pods.view" },
    ] });
    runtime.sdk.registerPluginRoutes("resources", { "/resources/pods": () => null });
  });
  if (includeComposition) add("operations", () => runtime.sdk.registerNavigationComposition(structuredClone(composition)));
  return modules;
}
const paths = (result: ReturnType<typeof applicationNavigation>) => flattenNavItems(result.groups.flatMap(group => group.items)).map(item => item.to);

describe("entry registry and navigation compositions", () => {
  it("registers business pages and an account-only application in the same plugin", () => {
    const runtime = createRegistration();
    runtime.begin({ id: "autotune", entry: "/plugins/autotune/index.js" });
    runtime.sdk.registerPlugin({
      name: "autotune", version: "1", displayName: "AutoTune",
      menus: [{ name: "tasks", path: "/autotune/tasks", authKey: "tasks.view" }],
      entries: [
        { name: "strategies", path: "/autotune/settings/strategies", authKey: "strategies.view", order: 0 },
        { name: "spaces", path: "/autotune/settings/spaces", authKey: "spaces.view" },
      ],
      navigationComposition: {
        scopes: [{ scope: "platform", title: "Settings", path: "/autotune/settings/strategies" }],
        groups: [{ name: "settings", title: "", menus: [
          { provider: "modelsphere.dev/autotune", entry: "strategies" },
          { provider: "modelsphere.dev/autotune", entry: "spaces" },
        ] }],
        launcher: false,
      },
      userMenu: [{ id: "settings", title: "Settings", target: { kind: "application", id: "autotune/platform" } }],
    });
    runtime.sdk.registerPluginRoutes("autotune", {
      "/autotune/tasks": () => null, "/autotune/settings/strategies": () => null, "/autotune/settings/spaces": () => null,
    });
    const module = runtime.finish();
    expect(() => validateModules([module])).not.toThrow();
    const landing = module.pages.find(page => page.path === "")?.element;
    expect(isValidElement<{ menus: SDKMenu[] }>(landing) && menuLandingPath(landing.props.menus, () => true, "/autotune")).toBe("/autotune/tasks");

    const main = applicationNavigation([module], () => true, "/autotune");
    expect(main.activeID).toBe("console");
    expect(paths(main)).toEqual(["/", "/autotune/tasks"]);
    const settings = applicationNavigation([module], () => true, "/autotune/settings/spaces");
    expect(settings.activeID).toBe("autotune/platform");
    expect(paths(settings)).toEqual(["/autotune/settings/strategies", "/autotune/settings/spaces"]);
    expect(settings.applications[1]).toMatchObject({ launcher: false, to: "/autotune/settings/strategies" });
    const partial = (permission: string) => permission === "spaces.view";
    const fallback = applicationNavigation([module], partial, "/");
    expect(resolveUserMenuItems([module], fallback.applications, partial)[0]?.to).toBe("/autotune/settings/spaces");
    const denied = applicationNavigation([module], () => false, "/");
    expect(resolveUserMenuItems([module], denied.applications, () => false)).toEqual([]);
  });

  it("integrates legacy plugins into Console without inferring applications from provider scopes", () => {
    const result = applicationNavigation(install(), () => true, "/canary/experiment-1");
    expect(result.activeID).toBe("console");
    expect(paths(result)).toContain("/canary");
    expect(result.applications.map(item => item.id)).toEqual(["console", "operations/cluster"]);
    expect(result.groups.find(group => group.id === "console/iam")?.ns).toBe("iam");
  });

  it("builds a composition without modifying provider pages or their default menu metadata", () => {
    const modules = install();
    const before = JSON.stringify(modules.map(module => module.pages.map(page => page.menu)));
    const result = applicationNavigation(modules, () => true, "/resources/pods/default/demo");
    expect(result.activeID).toBe("operations/cluster");
    expect(paths(result)).toEqual(["/resources/pods"]);
    expect(result.groups.map(group => group.title)).toEqual(["Resources"]);
    expect(JSON.stringify(modules.map(module => module.pages.map(page => page.menu)))).toBe(before);
  });

  it("does not turn unplaced business entries into menus or independent applications", () => {
    const result = applicationNavigation(install(false), () => true, "/resources/pods");
    expect(paths(result)).not.toContain("/resources/pods");
    expect(paths(result)).toContain("/canary");
    expect(result.applications).toEqual([]);
  });

  it("uses entry permissions and omits applications with no accessible static landing", () => {
    const result = applicationNavigation(install(), () => false, "/resources/pods");
    expect(result.applications).toEqual([]);
    expect(paths(result)).toEqual(["/", "/canary"]);
  });

  it("changes group and entry order in one host composition independently of provider order", () => {
    const modules = install(false);
    const host = { groups: [
      { name: "experiments", title: "Experiments", menus: [{ provider: "example.io/canary", entry: "experiments" }] },
      { name: "identity", title: "Identity", menus: [{ provider: "console/iam", entry: "users" }] },
    ] };
    const result = applicationNavigation([...modules].reverse(), () => true, "/iam/users/alice", host);
    expect(result.activeID).toBe("console");
    expect(paths(result)).toEqual(["/", "/canary", "/iam/users"]);
    expect(result.groups.slice(1).map(group => group.title)).toEqual(["Experiments", "Identity"]);
  });

  it("composes built-ins and plugins together while keeping platform and cluster references separate", () => {
    const modules = install();
    const application = modules.find(module => module.id === "operations")!;
    application.navigation!.scopes.push({ scope: "platform", title: "Workspace", icon: Boxes });
    application.navigation!.composition!.groups[0].menus = [
      { provider: "example.io/resources", entry: "pods", scope: "cluster" },
      { provider: "console/iam", entry: "users", scope: "platform" },
      { provider: "example.io/canary", entry: "experiments", scope: "platform" },
    ];
    const cluster = applicationNavigation(modules, () => true, "/resources/pods", { groups: [] });
    const platform = applicationNavigation(modules, () => true, "/iam/users/alice", { groups: [] });
    expect(cluster.applications.map(item => item.id)).toEqual(["console", "operations/cluster", "operations/platform"]);
    expect(paths(cluster)).toEqual(["/resources/pods"]);
    expect(platform.activeID).toBe("operations/platform");
    expect(paths(platform)).toEqual(["/iam/users", "/canary"]);
  });

  it("selects a nested Console route over another application's ancestor route", () => {
    const modules = install();
    const provider = modules.find(module => module.id === "resources")!;
    provider.pages.push({ path: "pods/settings", element: null, menu: { label: "Settings", icon: Boxes } });
    provider.navigation!.entries.push({ name: "settings", path: "/resources/pods/settings" });
    provider.navigation!.menus.push("settings");
    const result = applicationNavigation(modules, () => true, "/resources/pods/settings");
    expect(result.activeID).toBe("console");
    expect(paths(result)).toContain("/resources/pods/settings");
  });

  it("preserves legacy sibling and child order beside explicit host references", () => {
    const base: ConsoleModule = { id: "base", title: "Base", basePath: "/base", pages: [
      { path: "home", element: null, menu: { label: "Home", icon: Boxes } },
    ] };
    const extension: ConsoleModule = { id: "extension", title: "Extension", basePath: "/extension", pages: [
      { path: "later", element: null, menu: { label: "Later", icon: Boxes, parent: "base", order: 20 } },
      { path: "first", element: null, menu: { label: "First", icon: Boxes, parent: "base", order: 1 } },
      { path: "first/later", element: null, menu: { label: "Child later", icon: Boxes, parent: "base", treeParent: "/extension/first", order: 20 } },
      { path: "first/first", element: null, menu: { label: "Child first", icon: Boxes, parent: "base", treeParent: "/extension/first", order: 1 } },
    ] };
    const result = applicationNavigation([base, extension], () => true, "/base/home", { groups: [
      { name: "base", title: "Base", menus: [{ provider: "console/base", entry: "home" }] },
    ] });
    expect(paths(result)).toEqual(["/", "/base/home", "/extension/first", "/extension/first/first", "/extension/first/later", "/extension/later"]);
  });

  it("keeps entry aliases independently referenceable while deduplicating their shared route", () => {
    const runtime = createRegistration();
    runtime.begin({ id: "aliases", group: "example.io", entry: "/alias.js" });
    runtime.sdk.registerPlugin({ name: "aliases", version: "1", entries: [
      { name: "canonical", path: "/aliases/item", title: "Canonical", scope: "cluster" },
      { name: "alternate", path: "/aliases/item", title: "Alternate", scope: "cluster" },
    ] });
    runtime.sdk.registerPluginRoutes("aliases", { "/aliases/item": () => null });
    const provider = runtime.finish();
    expect(provider.navigation!.entries.map(entry => entry.name)).toEqual(["canonical", "alternate"]);
    runtime.end();
    runtime.begin({ id: "composition", entry: "/composition.js" });
    runtime.sdk.registerNavigationComposition({ name: "composition", version: "1", displayName: "Alias", scopes: [
      { scope: "cluster", path: "/aliases/item" },
    ], groups: [{ name: "aliases", title: "Aliases", menus: [
      { provider: "example.io/aliases", entry: "alternate" },
      { provider: "example.io/aliases", entry: "canonical" },
    ] }] });
    const result = applicationNavigation([provider, runtime.finish()], () => true, "/aliases/item/ns/name");
    expect(result.activeID).toBe("composition/cluster");
    expect(result.applications[1].to).toBe("/aliases/item");
    expect(paths(result)).toEqual(["/aliases/item"]);
    expect(result.groups[0].items[0].label).toBe("Alternate");
  });
});
