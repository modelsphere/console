import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Boxes } from "lucide-react";
import { navGroups, activeGroupTitle, type ConsoleModule } from "./module";
import { Sidebar, groupContainsPath, navigationItems } from "./Sidebar";

const folders = [{ id: "workloads", title: "工作负载" }, { id: "models", title: "模型" }];
const model: ConsoleModule = { id: "model", title: "模型服务", basePath: "/model", navigationFolders: folders, pages: [
  { path: "", element: null, menu: { label: "模型列表", icon: Boxes }, permission: "model.view" },
  { path: ":id", element: null, permission: "model.view" },
] };
const experiment: ConsoleModule = { ...model, id: "experiment", basePath: "/experiment", title: "实验", navigationFolders: [folders[0]], pages: [{ path: "", element: null, menu: { label: "实验列表", icon: Boxes } }] };

describe("configured navigation folders", () => {
  it("keeps ordered nested folders and prunes unauthorized descendants", () => {
    const groups = navGroups([model, experiment], () => true);
    expect(groups[1].children?.map((group) => group.title)).toEqual(["模型", "实验"]);
    expect(navigationItems(groups).map((item) => item.to)).toEqual(["/", "/model", "/experiment"]);
    const limited = navGroups([model, experiment], () => false);
    expect(limited[1].children?.map((group) => group.title)).toEqual(["实验"]);
    expect(navGroups([model], () => false)).toHaveLength(1);
  });

  it("opens every ancestor for a detail URL with no menu entry", () => {
    const groups = navGroups([model, experiment], () => true);
    expect(groupContainsPath(groups[1], "/model/detail")).toBe(true);
    expect(activeGroupTitle(groups, "/model/detail")).toBe("模型服务");
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/model/detail"]}><Sidebar groups={groups} collapsed={false} /></MemoryRouter>);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html).toContain("模型列表");
    expect(html).toContain("aria-controls=");
  });

  it("keeps all authorized descendant links reachable in the collapsed sidebar", () => {
    const groups = navGroups([model, experiment], () => true);
    const html = renderToStaticMarkup(<MemoryRouter><Sidebar groups={groups} collapsed /></MemoryRouter>);
    expect(html).toContain('href="/model"');
    expect(html).toContain('href="/experiment"');
    expect(html).toContain('title="模型列表"');
    expect(html).not.toContain('aria-expanded=');
  });

  it("separates folders with equal display titles by their IDs", () => {
    const other = { ...experiment, navigationFolders: [{ id: "other", title: "工作负载" }] };
    const groups = navGroups([model, other], () => true);
    expect(groups.map((group) => group.id)).toEqual([undefined, "folder:workloads", "folder:other"]);
  });
});
