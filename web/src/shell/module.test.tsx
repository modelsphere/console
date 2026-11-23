import { describe, expect, it } from "vitest";
import { Boxes } from "lucide-react";
import { activeGroupTitle, activeNavItem, joinPath, navGroups, topbarItems, validateModules, type ConsoleModule } from "@/shell/module";

const mod = (over: Partial<ConsoleModule> = {}): ConsoleModule => ({
  id: "swiss",
  title: "模型部署",
  basePath: "/swiss",
  pages: [
    { path: "", element: null, menu: { label: "部署", icon: Boxes } },
    { path: "catalog/:name", element: null },
  ],
  ...over,
});

describe("joinPath", () => {
  it("mounts a relative page under the module base", () => {
    expect(joinPath("/swiss", "catalog/kimi")).toBe("/swiss/catalog/kimi");
  });

  it("treats a leading slash as relative, so copied absolute links still land inside the module", () => {
    expect(joinPath("/swiss", "/catalog")).toBe("/swiss/catalog");
  });

  it("maps the empty path to the module index", () => {
    expect(joinPath("/swiss", "")).toBe("/swiss");
  });
});

describe("validateModules", () => {
  it("accepts well-formed modules", () => {
    expect(() => validateModules([mod(), mod({ id: "iam", basePath: "/iam" })])).not.toThrow();
  });

  it("rejects two modules on one basePath", () => {
    expect(() => validateModules([mod(), mod({ id: "other" })])).toThrow(/already taken/);
  });

  it("rejects a duplicate id", () => {
    expect(() => validateModules([mod(), mod({ basePath: "/other" })])).toThrow(/duplicate module id/);
  });

  it("rejects paths the shell owns", () => {
    expect(() => validateModules([mod({ basePath: "/login" })])).toThrow(/reserved/);
    expect(() => validateModules([mod({ basePath: "/api" })])).toThrow(/reserved/);
  });

  it("rejects a malformed basePath", () => {
    expect(() => validateModules([mod({ basePath: "swiss" })])).toThrow(/basePath/);
    expect(() => validateModules([mod({ basePath: "/swiss/" })])).toThrow(/basePath/);
  });

  it("rejects a page declared twice", () => {
    const p = { path: "x", element: null };
    expect(() => validateModules([mod({ pages: [p, p] })])).toThrow(/declared twice/);
  });
});

describe("navGroups", () => {
  const iam = mod({
    id: "iam",
    title: "访问控制",
    basePath: "/iam",
    pages: [
      { path: "users", element: null, permission: "users.view", menu: { label: "用户", icon: Boxes } },
      { path: "roles", element: null, permission: "roles.view", menu: { label: "角色", icon: Boxes } },
      { path: "users/:name", element: null, permission: "users.view" },
    ],
  });
  const labels = (has: (p: string) => boolean) =>
    navGroups([iam, mod()], has).map((g) => [g.title ?? "", g.items.map((i) => `${i.label}@${i.to}${i.end ? "$" : ""}`)]);

  it("lists menu pages under their module, with absolute paths", () => {
    expect(labels(() => true)).toEqual([
      ["", ["概览@/$"]],
      ["访问控制", ["用户@/iam/users", "角色@/iam/roles"]],
      ["模型部署", ["部署@/swiss$"]],
    ]);
  });

  it("hides pages the user lacks permission for", () => {
    expect(labels((p) => p === "roles.view")[1]).toEqual(["访问控制", ["角色@/iam/roles"]]);
  });

  it("opens the module a page is mounted under, menu entry or not", () => {
    const groups = navGroups([iam, mod()], () => true);
    expect(activeGroupTitle(groups, "/swiss")).toBe("模型部署");
    expect(activeGroupTitle(groups, "/swiss/deployments/ns/r")).toBe("模型部署");
    expect(activeGroupTitle(groups, "/iam/users/alice")).toBe("访问控制");
    expect(activeGroupTitle(groups, "/swissx")).toBeUndefined();
    expect(activeGroupTitle(groups, "/")).toBeUndefined();
  });

  it("drops a module whose every menu page is hidden", () => {
    expect(labels(() => false).map(([t]) => t)).toEqual(["", "模型部署"]);
  });
});

describe("topbarItems", () => {
  const help = mod({
    id: "docs",
    title: "帮助",
    basePath: "/help",
    pages: [
      { path: "docs", element: null, menu: { label: "使用文档", icon: Boxes }, topbar: true },
      { path: "docs/:chapter", element: null },
      { path: "admin", element: null, permission: "x.view", menu: { label: "管理", icon: Boxes }, topbar: true },
    ],
  });

  it("lists only pages declared for the top bar that the user may open", () => {
    expect(topbarItems([mod(), help], () => false).map((i) => `${i.label}@${i.to}`)).toEqual(["使用文档@/help/docs"]);
    expect(topbarItems([mod(), help], () => true).map((i) => i.to)).toEqual(["/help/docs", "/help/admin"]);
  });

  const serving = mod({
    id: "inferences",
    basePath: "/inferences",
    pages: [{ path: "catalog", element: null, permission: "swiss.view", menu: { label: "模型库", icon: Boxes }, topbar: { label: "模型广场" } }],
  });

  it("uses a top-bar label without changing the sidebar or page destination", () => {
    const [item] = topbarItems([serving], () => true);
    expect(item).toMatchObject({ label: "模型广场", to: "/inferences/catalog", ns: "inferences", key: "catalogTopbar" });
    expect(navGroups([serving], () => true)[1].items[0]).toMatchObject({ label: "模型库", to: item.to, key: "catalog" });
  });

  it("hides the model plaza when the catalog permission is missing", () => {
    expect(topbarItems([serving, help], () => false).map((i) => i.to)).toEqual(["/help/docs"]);
  });
});

describe("plugin sidebar ownership", () => {
  it("uses static route specificity when competing parent sidebars own dynamic and static pages", () => {
    const first = mod({ id: "first", title: "动态归属", basePath: "/first" });
    const second = mod({ id: "second", title: "静态归属", basePath: "/second" });
    const contributor = mod({ id: "extra", basePath: "/extra", pages: [
      { path: "jobs/:id", element: null, menu: { label: "详情", icon: Boxes, parent: "first", hidden: true } },
      { path: "jobs/new", element: null, menu: { label: "新建", icon: Boxes, parent: "second" } },
    ] });
    const groups = navGroups([first, second, contributor], () => true);
    expect(activeGroupTitle(groups, "/extra/jobs/new")).toBe("静态归属");
    expect(activeGroupTitle(groups, "/extra/jobs/42")).toBe("动态归属");
  });

  it("selects only the most-specific menu, retaining that menu on hidden detail routes", () => {
    const module = mod({ pages: [
      { path: "", element: null, menu: { label: "全部", icon: Boxes } },
      { path: "list", element: null, menu: { label: "列表", icon: Boxes } },
      { path: "list/settings", element: null, menu: { label: "设置", icon: Boxes } },
    ] });
    const items = navGroups([module], () => true).flatMap(group => group.items);
    expect(activeNavItem(items, "/swiss/list/settings")?.label).toBe("设置");
    expect(activeNavItem(items, "/swiss/list/settings/details")?.label).toBe("设置");
    expect(activeNavItem(items, "/swiss/list/42")?.label).toBe("列表");
    expect(activeNavItem(items, "/swiss/other")?.label).toBe("全部");
    expect(activeNavItem(items, "/other")).toBeUndefined();
    expect(activeNavItem(items, "/")?.label).toBe("概览");
  });

  it("aggregates contributions into their parent, merges group titles, and sorts by order", () => {
    const target = mod({ id: "target", title: "目标插件", basePath: "/target", pages: [
      { path: "home", element: null, menu: { label: "首页", icon: Boxes, group: "资源", order: 200 } },
    ] });
    const contributor = mod({ id: "extra", basePath: "/extra", pages: [
      { path: "jobs", element: null, menu: { label: "任务", icon: Boxes, parent: "target", group: "资源", order: 100, key: "jobs" } },
      { path: "jobs/:id", element: null },
    ] });
    const groups = navGroups([target, contributor], () => true);
    expect(groups).toHaveLength(2);
    expect(groups[1].items.map(item => [item.label, item.to, item.group, item.ns])).toEqual([
      ["任务", "/extra/jobs", "资源", "extra"],
      ["首页", "/target/home", "资源", "target"],
    ]);
    expect(activeGroupTitle(groups, "/extra/jobs/42")).toBe("目标插件");
  });

  it("does not reassign a contribution when the parent is unavailable", () => {
    const module = mod({ pages: [{ path: "", element: null, menu: { label: "任务", icon: Boxes, parent: "missing" } }] });
    expect(navGroups([module], () => true)).toHaveLength(1);
  });

  it("accepts a multi-segment namespace but rejects overlapping module namespaces", () => {
    expect(() => validateModules([mod({ basePath: "/rise.io/v1/example" })])).not.toThrow();
    expect(() => validateModules([mod(), mod({ id: "other", basePath: "/swiss/nested" })])).toThrow(/already taken|overlap/);
  });
});
