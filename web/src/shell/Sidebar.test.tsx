import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Boxes } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ModuleProvider, navGroups, useModulePath, type ConsoleModule } from "./module";

const module: ConsoleModule = {
  id: "example", title: "Example", basePath: "/example", pages: [
    { path: "tools", element: null, menu: { label: "Tools", icon: Boxes } },
    { path: "jobs", element: null, menu: { label: "Jobs", icon: Boxes, treeParent: "/example/tools" } },
    { path: "runs", element: null, basePath: "/billing", menu: { label: "Runs", icon: Boxes, treeParent: "/example/jobs" } },
  ],
};

function render(path: string, board = false, collapsed = false): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>
    <Sidebar groups={navGroups([module], () => true)} board={board} collapsed={collapsed} />
  </MemoryRouter>);
}

describe("recursive sidebar", () => {
  it.each([false, true])("opens the complete active ancestry with board=%s", board => {
    const html = render("/billing/runs/42", board);
    expect(html).toContain('aria-label="Tools" aria-expanded="true"');
    expect(html).toContain('aria-label="Jobs" aria-expanded="true"');
    expect(html).toContain('href="/billing/runs"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>.*?<span class="truncate">Runs<\/span>/);
  });

  it("starts inactive branches closed and associates their controls with the child region", () => {
    const html = render("/example/tools");
    expect(html).toContain('aria-label="Tools" aria-expanded="false" aria-controls=');
    expect(html).toMatch(/id="[^"]+" hidden=""/);
  });

  it("keeps every level reachable in icon-only navigation", () => {
    const html = render("/billing/runs", false, true);
    for (const path of ["/example/tools", "/example/jobs", "/billing/runs"]) expect(html).toContain(`href="${path}"`);
    expect(html).toContain('title="Runs"');
    expect(html).not.toContain("aria-expanded");
  });

  it("resolves module-relative page links in the current page's namespace", () => {
    function PageLinks() {
      const path = useModulePath();
      return <a href={path("details")}>Details</a>;
    }
    const html = renderToStaticMarkup(<ModuleProvider module={module} basePath="/billing"><PageLinks /></ModuleProvider>);
    expect(html).toContain('href="/billing/details"');
  });
});
