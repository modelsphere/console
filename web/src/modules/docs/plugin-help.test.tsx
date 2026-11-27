import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityContext } from "@/shell/capabilities";
import { createRegistration } from "@/shell/global-sdk/runtime";
import { ModuleProvider } from "@/shell/module";
import { PermissionsProvider } from "@/shell/permissions";
import { DocsPage } from "./DocsPage";

const state = vi.hoisted(() => ({ locale: "en-US", permissions: [] as string[] }));
vi.mock("@/shell/auth", () => ({ useAuth: () => ({ me: { name: "reader", permissions: state.permissions } }) }));
vi.mock("@/shell", async (original) => ({ ...await original<typeof import("@/shell")>(), useLocale: () => ({ locale: state.locale }) }));

const chapter = {
  slug: "example",
  title: { "en-US": "Example guide", "zh-CN": "Example localized guide" },
  content: { "en-US": "# Example help\n\n![Diagram](images/diagram.svg)", "zh-CN": "# Localized help" },
};
const runtimes: ReturnType<typeof createRegistration>[] = [];

afterEach(() => {
  state.locale = "en-US";
  state.permissions = [];
  for (const runtime of runtimes.splice(0)) { runtime.rollback(); runtime.end(); }
});

function plugin(id = "example", backend = false) {
  const runtime = createRegistration();
  runtimes.push(runtime);
  runtime.begin({ id, entry: `/plugins/test--${id}/index.js`, ...(backend ? { backend: { name: id, prefix: `/api/${id}` } } : {}) });
  runtime.sdk.registerPlugin({ name: id, version: "1.0.0", menus: [{ name: "home", path: `/${id}` }] });
  runtime.sdk.registerPluginRoutes(id, { [`/${id}`]: () => null });
  return runtime;
}

function render(slug = "example", canRead = true, loading = false) {
  const module = { id: "docs", title: "Help", basePath: "/help", pages: [] };
  return renderToStaticMarkup(
    <CapabilityContext.Provider value={{ data: { example: { configured: true, canRead, canWrite: false } }, loading, failed: false, retry: () => undefined }}>
      <PermissionsProvider><ModuleProvider module={module}>
        <MemoryRouter initialEntries={[`/help/docs/${slug}`]}><Routes>
          <Route path="/help/docs/:chapter" element={<DocsPage />} />
        </Routes></MemoryRouter>
      </ModuleProvider></PermissionsProvider>
    </CapabilityContext.Provider>,
  );
}

describe("plugin help chapters", () => {
  it("renders bundled localized Markdown, release-relative images and existing chapter URLs", () => {
    const runtime = plugin();
    runtime.sdk.registerHelpChapter("example", chapter);
    runtime.finish();
    const html = render();
    expect(html).toContain("Example guide");
    expect(html).toContain("Example help");
    expect(html).toContain('src="/plugins/test--example/images/diagram.svg"');
    expect(html).toContain('href="/help/docs/example"');
    expect(html).toContain('href="/help/docs/getting-started"');
    state.locale = "zh-CN";
    expect(render()).toContain("Example localized guide");
    expect(render()).toContain("Localized help");
  });

  it("hides the chapter and its direct URL until both UI and backend access are available", () => {
    const runtime = plugin("example", true);
    runtime.sdk.registerHelpChapter("example", { ...chapter, authKey: "example.view" });
    runtime.finish();
    expect(render()).not.toContain("Example help");
    state.permissions = ["example.view"];
    expect(render("example", false)).not.toContain("Example help");
    expect(render("example", true, true)).not.toContain("Example help");
    expect(render()).toContain("Example help");
  });

  it("removes a failed registration without disturbing built-in chapters or another plugin", () => {
    const runtime = plugin();
    runtime.sdk.registerHelpChapter("example", chapter);
    runtime.finish();
    const other = plugin("other");
    other.sdk.registerHelpChapter("other", { ...chapter, slug: "other" });
    other.finish();
    runtime.rollback();
    expect(render()).not.toContain("Example help");
    expect(render("other")).toContain("Example help");
    expect(render()).toContain('href="/help/docs/getting-started"');
  });

  it.each([
    { ...chapter, slug: "deploy" },
    { ...chapter, slug: "other" },
    { ...chapter, slug: "example/../../api" },
    { ...chapter, content: { "en-US": "# Missing locale" } },
    { ...chapter, title: { "en-US": "", "zh-CN": "Guide" } },
    { ...chapter, authKey: 42 },
  ])("rejects malformed or foreign chapter declarations: %j", (invalid) => {
    const runtime = plugin();
    runtime.sdk.registerHelpChapter("example", invalid as typeof chapter);
    expect(() => runtime.finish()).toThrow(/help chapter/i);
    runtime.rollback();
    expect(render()).not.toContain("Example help");
  });

  it("rejects duplicate slugs and preserves the first owner's chapter", () => {
    const runtime = plugin();
    runtime.sdk.registerHelpChapter("example", chapter);
    runtime.sdk.registerHelpChapter("example", chapter);
    expect(() => runtime.finish()).toThrow(/help chapter/i);
  });

  it("does not resolve relative images outside the plugin's asset directory", () => {
    const runtime = plugin();
    runtime.sdk.registerHelpChapter("example", { ...chapter, content: { ...chapter.content, "en-US": "# Example help\n\n![Unsafe](../outside.svg)\n\n![Encoded](%2e%2e/outside.svg)" } });
    runtime.finish();
    expect(render()).not.toContain("outside.svg");
  });
});
