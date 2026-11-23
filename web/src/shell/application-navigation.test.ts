import { Boxes } from "lucide-react";
import { describe, expect, it } from "vitest";
import { applicationNavigation } from "./application-navigation";
import { flattenNavItems, type ConsoleModule } from "./module";

const menu = { label: "Page", icon: Boxes };
const builtin: ConsoleModule = { id: "iam", title: "IAM", basePath: "/iam", pages: [{ path: "users", element: null, menu }] };
const dashboard: ConsoleModule = {
  id: "dashboard", title: "Dashboard", basePath: "/dashboard",
  navigation: {
    provider: "test/dashboard", scopes: [{ scope: "cluster", title: "Cluster", icon: Boxes }], menus: [],
    entries: [{ name: "pods", path: "/dashboard/pods" }, { name: "nodes", path: "/dashboard/nodes" }],
    composition: { groups: [{ name: "resources", title: "", menus: [
      { provider: "test/dashboard", entry: "pods" }, { provider: "test/dashboard", entry: "nodes" },
    ] }] },
  },
  pages: [
    { path: "pods", element: null, menu: { ...menu, scope: "cluster" } },
    { path: "pods/*", element: null },
    { path: "nodes", element: null, permission: "nodes.view", menu: { ...menu, scope: "cluster" } },
  ],
};
const paths = (navigation: ReturnType<typeof applicationNavigation>) => flattenNavItems(navigation.groups.flatMap(group => group.items)).map(item => item.to);

describe("application navigation", () => {
  it("offers Console as a return target and separates its menus from composed applications", () => {
    const navigation = applicationNavigation([builtin, dashboard], () => true, "/iam/users");
    expect(navigation.activeID).toBe("console");
    expect(navigation.applications).toMatchObject([{ id: "console", to: "/" }, { id: "dashboard/cluster", to: "/dashboard/pods" }]);
    expect(paths(navigation)).toEqual(["/", "/iam/users"]);
  });

  it.each(["/dashboard/pods", "/dashboard/pods/default/example"])("derives application ownership from %s without stored selection", pathname => {
    const navigation = applicationNavigation([builtin, dashboard], () => false, pathname);
    expect(navigation.activeID).toBe("dashboard/cluster");
    expect(paths(navigation)).toEqual(["/dashboard/pods"]);
    expect(navigation.groups.every(group => !group.title)).toBe(true);
  });

  it("keeps legacy modules in Console and hides an unnecessary application switcher", () => {
    const navigation = applicationNavigation([builtin], () => true, "/iam/users");
    expect(navigation.applications).toEqual([]);
    expect(paths(navigation)).toEqual(["/", "/iam/users"]);
  });

  it("follows explicit entry references across provider and route namespaces", () => {
    const contribution: ConsoleModule = { id: "extra", title: "Extra", basePath: "/extra", pages: [
      { path: "reports", element: null, menu: { ...menu, scope: "cluster" } },
      { path: "reports/:id", element: null },
      { path: "local", element: null, menu },
    ] };
    const composed = structuredCloneComposition();
    composed.navigation!.composition!.groups[0].menus.push({ provider: "console/extra", entry: "reports" });
    const navigation = applicationNavigation([builtin, composed, contribution], () => true, "/extra/reports/42");
    expect(navigation.activeID).toBe("dashboard/cluster");
    expect(paths(navigation)).toContain("/extra/reports");
    expect(paths(navigation)).not.toContain("/extra/local");
    expect(paths(applicationNavigation([builtin, composed, contribution], () => true, "/extra/local"))).toContain("/extra/local");
  });

  it("keeps unscoped legacy menus in Console despite a provider's cluster declaration", () => {
    const provider = structuredCloneComposition();
    provider.pages = [...provider.pages, { path: "settings", element: null, menu }, { path: "settings/:id", element: null }];
    provider.navigation!.entries.push({ name: "settings", path: "/dashboard/settings" });
    provider.navigation!.menus.push("settings");
    for (const pathname of ["/dashboard/settings", "/dashboard/settings/general"]) {
      const navigation = applicationNavigation([builtin, provider], () => true, pathname);
      expect(navigation.activeID).toBe("console");
      expect(paths(navigation)).toContain("/dashboard/settings");
    }
    expect(paths(applicationNavigation([builtin, provider], () => true, "/dashboard/pods"))).not.toContain("/dashboard/settings");
  });
});

function structuredCloneComposition(): ConsoleModule {
  return { ...dashboard, navigation: { ...dashboard.navigation!, entries: [...dashboard.navigation!.entries], menus: [],
    composition: { groups: dashboard.navigation!.composition!.groups.map(group => ({ ...group, menus: [...group.menus] })) },
  } };
}
