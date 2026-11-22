import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createGlobalHost } from "./host";
import { pagePath, validateModules } from "@/shell/module";
import { applicationNavigation } from "@/shell/application-navigation";
import { scopeForPath } from "./scope";

const dashboard = readFileSync(new URL("./fixtures/global-dashboard-0.5.89.umd.js", import.meta.url), "utf8");
const composition = readFileSync(new URL("./fixtures/global-dashboard-menu-0.1.6.umd.js", import.meta.url), "utf8");

// Unmodified upstream build artifacts, pinned in fixtures/README.md.
describe("Global Dashboard published bundles", () => {
  it.each([false, true])("loads the original Dashboard and optional menu composition (menu first: %s)", menuFirst => {
    const runtime = createGlobalHost();
    const entries = [
      { id: "k8s-dashboard", source: dashboard },
      { id: "menu-k8s-cluster-management", source: composition },
    ];
    if (menuFirst) entries.reverse();
    const modules = entries.map(entry => {
      runtime.begin({ id: entry.id, group: "rise.io", entry: `/plugins/${entry.id}/index.umd.js` });
      runInNewContext(entry.source, { __RISE_SDK__: runtime.host, window: { __RISE_SDK__: runtime.host }, console });
      const module = runtime.finish();
      runtime.commit();
      runtime.end();
      return module;
    });
    const composed = modules;
    expect(() => validateModules(composed)).not.toThrow();
    const module = composed.find(candidate => candidate.id === "k8s-dashboard")!;
    const pods = module.pages.find(page => pagePath(module, page) === "/rise.io/v1/k8s-dashboard/pods")!;
    expect(pods.permission).toBe("k8s-dashboard.rise.io/dashboard.view");
    expect(pods.menu?.group).toBeUndefined();
    const navigation = applicationNavigation(composed, () => true, "/rise.io/v1/k8s-dashboard/pods/default/demo");
    expect(navigation.activeID).toBe("menu-k8s-cluster-management/cluster");
    expect(navigation.groups.find(group => group.title === "工作负载")?.items.some(item => item.to.endsWith("/pods"))).toBe(true);
    expect(navigation.applications.map(item => item.id)).toEqual(["console", "menu-k8s-cluster-management/cluster"]);
    expect(module.pages.some(page => page.path === "pods/*")).toBe(true);
    expect(module.navigation!.scopes).toMatchObject([{ scope: "cluster" }]);
    expect(runtime.getScope("/rise.io/v1/k8s-dashboard/pods/default/example")).toEqual({ scope: "cluster", value: "current", full: "cluster/current" });
  });

  it("does not infer cluster context on unrelated pages", () => {
    const definitions = [{ name: "test", version: "1", menus: [{ name: "pods", path: "/dashboard/pods", scope: "cluster" }] }];
    expect(scopeForPath("/dashboard/pods/x", definitions).scope).toBe("cluster");
    expect(scopeForPath("/dashboard/podstuff", definitions).scope).toBe("platform");
    expect(scopeForPath("/iam/users", definitions).value).toBe("global");
  });

  it("matches normalized dynamic routes and inherits nested cluster context", () => {
    const definitions = [{ name: "test", version: "1", menus: [{ name: "home", path: "/dashboard", scope: "cluster", children: [
      { name: "item", path: "/dashboard/items/[id]" },
    ] }] }];
    expect(scopeForPath("/DASHBOARD/items/42/details", definitions).scope).toBe("cluster");
  });

  it("prefers a literal route over a matching parameterized route", () => {
    const definitions = [{ name: "test", version: "1", menus: [
      { name: "item", path: "/example/:veryLongParameterName", scope: "cluster" },
      { name: "settings", path: "/example/settings", scope: "platform" },
    ] }];
    expect(scopeForPath("/example/settings", definitions).scope).toBe("platform");
  });
});
