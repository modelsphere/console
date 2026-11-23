import { Boxes } from "lucide-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";
import { getLocale, i18n, registerI18n, setLocale } from "./i18n";
import type { ConsoleModule } from "./module";
import { PermissionsProvider } from "./permissions";

const state = vi.hoisted(() => ({
  authDisabled: false,
  layout: "minimal",
  permissions: ["reports.read"],
}));

vi.mock("@/shell/auth", () => ({
  useAuth: () => ({
    me: { name: "tester", isAdmin: state.authDisabled, authDisabled: state.authDisabled, permissions: state.permissions },
    logout: vi.fn(),
  }),
}));
vi.mock("@/shell/preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("./preferences")>(),
  useLayout: () => state.layout,
}));
vi.mock("@modelsphere/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@modelsphere/ui")>(),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const module: ConsoleModule = {
  id: "reports",
  title: "Reports",
  basePath: "/reports",
  pages: [{ path: "", element: null, permission: "reports.read", menu: { key: "index", label: "Reports", icon: Boxes } }],
  userMenu: [{ id: "reports-home", title: "Open reports", target: { kind: "entry", name: "index" } }],
};

const locale = getLocale();
afterEach(() => {
  state.authDisabled = false;
  state.layout = "minimal";
  state.permissions = ["reports.read"];
  setLocale(locale);
  i18n.removeResourceBundle("en-US", module.id);
  i18n.removeResourceBundle("zh-CN", module.id);
});

function render() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PermissionsProvider>
        <Layout modules={[module]}><div /></Layout>
      </PermissionsProvider>
    </MemoryRouter>,
  );
}

describe("plug-in account menu links", () => {
  it.each(["minimal", "classic", "mixed-nav"])("renders the resolved link before the account actions in %s", layout => {
    state.layout = layout;
    setLocale("en-US");
    const html = render();
    expect(html).toMatch(/<a\b(?=[^>]*href="\/reports")(?=[^>]*role="menuitem")[^>]*>Open reports<\/a>/);
    expect(html.indexOf("Open reports")).toBeLessThan(html.indexOf("Change password"));
    expect(html).toContain("Sign out");
  });

  it("renders the contribution's translation and keeps links in no-login mode", () => {
    registerI18n(module.id, {
      "zh-CN": { userMenu: { "reports-home": "打开报告" } },
      "en-US": { userMenu: { "reports-home": "View reports" } },
    });
    state.authDisabled = true;
    setLocale("zh-CN");
    expect(render()).toContain("打开报告");

    setLocale("en-US");
    const html = render();
    expect(html).toContain("View reports");
    expect(html.indexOf("Sign-in off")).toBeLessThan(html.indexOf("View reports"));
    expect(html).not.toContain("Change password");
    expect(html).not.toContain("Sign out");
  });

  it("omits the link and the extra separator when the target is unauthorized", () => {
    state.permissions = [];
    const html = render();
    expect(html).not.toContain("Open reports");
    expect(html.match(/data-slot="dropdown-menu-separator"/g)).toHaveLength(2);
  });
});
