import { describe, expect, it } from "vitest";
import { Boxes } from "lucide-react";
import { activeGroupTitle, joinPath, navGroups, validateModules, type ConsoleModule } from "@/shell/module";

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
