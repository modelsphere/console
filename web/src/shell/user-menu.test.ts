import { Boxes } from "lucide-react";
import { describe, expect, it } from "vitest";
import { resolveUserMenuItems, userMenuIdentity, userMenuState } from "@/shell/user-menu";
import type { Me } from "@/shell/api";
import { applicationNavigation } from "./application-navigation";
import { availableModules } from "./capabilities";
import type { ConsoleModule } from "./module";

const me = (over: Partial<Me> = {}): Me => ({
  name: "admin",
  groups: [],
  isAdmin: true,
  permissions: ["*"],
  requirePasswordReset: false,
  ...over,
});

describe("userMenuState", () => {
  it("offers both entries when console logs people in", () => {
    expect(userMenuState(me())).toEqual({ entries: ["changePassword", "logout"], noLogin: false });
  });

  it("draws no entries and says why when console runs without a login", () => {
    expect(userMenuState(me({ authDisabled: true }))).toEqual({ entries: [], noLogin: true });
  });

  it("keeps the entries when there is no session to read yet", () => {
    expect(userMenuState(null)).toEqual({ entries: ["changePassword", "logout"], noLogin: false });
  });
});

describe("userMenuIdentity", () => {
  it("carries the name and the role", () => {
    expect(userMenuIdentity(me())).toEqual({ name: "admin", role: "admin", email: undefined });
    expect(userMenuIdentity(me({ name: "li", isAdmin: false }))).toEqual({ name: "li", role: "member", email: undefined });
    expect(userMenuIdentity(null)).toEqual({ name: "", role: "member", email: undefined });
  });

  it("carries the email only when console has one to read", () => {
    expect(userMenuIdentity(me({ email: "admin@example.com" })).email).toBe("admin@example.com");
    expect(userMenuIdentity(me({ authDisabled: true })).email).toBeUndefined();
  });
});

const menu = { label: "Reports", icon: Boxes };
const reportPage = { path: "reports", element: null, menu: { ...menu, key: "reports" } };
const reportLink = { id: "reports", title: "Open reports", target: { kind: "entry", name: "reports" } } as const;

describe("resolveUserMenuItems", () => {
  it("resolves an entry only from the module that contributes it", () => {
    const provider: ConsoleModule = {
      id: "provider", title: "Provider", basePath: "/provider", pages: [reportPage],
    };
    const contributor: ConsoleModule = {
      id: "contributor", title: "Contributor", basePath: "/contributor", pages: [reportPage], userMenu: [reportLink],
    };
    expect(resolveUserMenuItems([provider, contributor], [], () => true)).toEqual([{
      key: "contributor:reports", id: "reports", namespace: "contributor", title: "Open reports", to: "/contributor/reports", order: 999,
    }]);
    expect(resolveUserMenuItems([provider, { ...contributor, pages: [] }], [], () => true)).toEqual([]);
  });

  it("excludes unavailable modules and entries that require backend write access", () => {
    const contributor: ConsoleModule = {
      id: "reports", title: "Reports", basePath: "/reports", capability: "reports",
      pages: [{ ...reportPage, requiresWrite: true }], userMenu: [reportLink],
    };
    const has = () => true;
    expect(resolveUserMenuItems(availableModules([contributor]), [], has)).toEqual([]);
    expect(resolveUserMenuItems(availableModules([contributor], {
      reports: { configured: true, canRead: true, canWrite: false },
    }), [], has)).toEqual([]);
    expect(resolveUserMenuItems(availableModules([contributor], {
      reports: { configured: true, canRead: true, canWrite: true },
    }), [], has)).toMatchObject([{ to: "/reports/reports" }]);
  });

  it("excludes hidden, denied and dynamic entries, including children of denied or hidden pages", () => {
    const contributor: ConsoleModule = {
      id: "reports", title: "Reports", basePath: "/reports",
      pages: [
        reportPage,
        { path: "private", permission: "private.view", element: null, menu: { ...menu, key: "private" } },
        { path: "private/report", element: null, menu: { ...menu, key: "private-report", treeParent: "/reports/private" } },
        { path: "hidden", element: null, menu: { ...menu, key: "hidden", hidden: true } },
        { path: "hidden/report", element: null, menu: { ...menu, key: "hidden-report", treeParent: "/reports/hidden" } },
        { path: "item/:id", element: null, menu: { ...menu, key: "item" } },
        { path: "search/*", element: null, menu: { ...menu, key: "search" } },
      ],
      userMenu: ["reports", "private", "private-report", "hidden", "hidden-report", "item", "search"].map(id => ({
        id, title: id, target: { kind: "entry", name: id },
      })),
    };
    expect(resolveUserMenuItems([contributor], [], () => false).map(link => link.id)).toEqual(["reports"]);
    expect(resolveUserMenuItems([contributor], [], () => true).map(link => link.id)).toEqual(["private", "private-report", "reports"]);
  });

  it("reuses the application's authorized landing, including fallback and removal", () => {
    const contributor: ConsoleModule = {
      id: "autotune", title: "Autotune", basePath: "/autotune",
      pages: [
        { path: "strategies", permission: "strategies.view", element: null, menu: { ...menu, key: "strategies" } },
        { path: "templates", permission: "templates.view", element: null, menu: { ...menu, key: "templates" } },
      ],
      userMenu: [{ id: "settings", title: "Tuning settings", target: { kind: "application", id: "settings/platform" } }],
    };
    const composition: ConsoleModule = {
      id: "settings", title: "Settings", basePath: "/settings", pages: [],
      navigation: {
        provider: "test/settings", entries: [], menus: [],
        scopes: [{ scope: "platform", title: "Settings", icon: Boxes, path: "/autotune/strategies" }],
        composition: { groups: [{ name: "autotune", title: "Autotune", menus: [
          { provider: "console/autotune", entry: "strategies" },
          { provider: "console/autotune", entry: "templates" },
        ] }] },
      },
    };
    const modules = [contributor, composition];
    const all = () => true;
    const templatesOnly = (permission: string) => permission === "templates.view";
    const none = () => false;
    expect(resolveUserMenuItems(modules, applicationNavigation(modules, all, "/").applications, all)).toMatchObject([{ to: "/autotune/strategies" }]);
    expect(resolveUserMenuItems(modules, applicationNavigation(modules, templatesOnly, "/").applications, templatesOnly)).toMatchObject([{ to: "/autotune/templates" }]);
    expect(resolveUserMenuItems(modules, applicationNavigation(modules, none, "/").applications, none)).toEqual([]);
    expect(resolveUserMenuItems([contributor], applicationNavigation([contributor], all, "/").applications, all)).toEqual([]);
  });

  it("sorts by order, contributing module and item ID", () => {
    const last: ConsoleModule = {
      id: "second", title: "Second", basePath: "/second", pages: [reportPage],
      userMenu: [reportLink, { ...reportLink, id: "early", order: -1 }],
    };
    const first: ConsoleModule = {
      id: "first", title: "First", basePath: "/first", pages: [reportPage],
      userMenu: [reportLink, { ...reportLink, id: "another", order: 999 }],
    };
    const keys = (modules: ConsoleModule[]) => resolveUserMenuItems(modules, [], () => true).map(link => link.key);
    expect(keys([last, first])).toEqual(["second:early", "first:another", "first:reports", "second:reports"]);
    expect(keys([first, last])).toEqual(keys([last, first]));
  });
});
