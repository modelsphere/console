import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CapabilityContext, CapabilityGuard, availableModules, type CapabilityState } from "@/shell/capabilities";
import { FlaskConical, Plus } from "lucide-react";
import { navGroups, type ConsoleModule } from "@/shell/module";
import { setLocale } from "@/shell/i18n";
const optionalModule: ConsoleModule = { id: "optional", title: "Optional", basePath: "/optional", capability: "optional", pages: [
  { path: "", element: null, menu: { label: "List", icon: FlaskConical } },
  { path: "new", element: null, permission: "optional.write", requiresWrite: true, menu: { label: "New", icon: Plus } },
  { path: "pricing", element: null, menu: { label: "Pricing", icon: FlaskConical } },
] };

const other: ConsoleModule = { id: "other", title: "Other", basePath: "/other", pages: [] };
const state = (configured: boolean, canRead: boolean, canWrite: boolean): CapabilityState => ({ loading: false, failed: false, retry: vi.fn(), data: { optional: { configured, canRead, canWrite } } });
const render = (value: CapabilityState, write = false) => renderToStaticMarkup(
  <CapabilityContext.Provider value={value}><CapabilityGuard capability="optional" write={write}><span>Protected content</span></CapabilityGuard></CapabilityContext.Provider>,
);

describe("optional module navigation and direct routes", () => {
  it.each([undefined, state(false, false, false).data, state(true, false, false).data])("hides optional module without configuration/read access while keeping other modules", (data) => {
    expect(availableModules([other, optionalModule], data)).toEqual([other]);
  });

  it("reader sees list/pricing navigation and can open existing records", () => {
    const value = state(true, true, false);
    const modules = availableModules([optionalModule], value.data);
    expect(navGroups(modules, () => true).flatMap((g) => g.items).map((i) => i.to)).toEqual(["/", "/optional", "/optional/pricing"]);
    expect(render(value)).toContain("Protected content");
    expect(render(value, true)).not.toContain("Protected content");
  });

  it("writer sees create navigation and write routes", () => {
    const value = state(true, true, true);
    expect(navGroups(availableModules([optionalModule], value.data), () => true).flatMap((g) => g.items).map((i) => i.to)).toContain("/optional/new");
    expect(render(value, true)).toContain("Protected content");
  });

  it("blocks direct URLs while loading, unconfigured, forbidden or capability fetch failed", () => {
    setLocale("en-US");
    for (const value of [state(false, false, false), state(true, false, false), { ...state(true, true, true), loading: true }, { ...state(true, true, true), failed: true }]) {
      expect(render(value)).not.toContain("Protected content");
    }
    expect(render(state(false, false, false))).toContain("not configured");
    expect(render(state(true, false, false))).toContain("permission");
    expect(render({ ...state(true, true, true), failed: true })).toContain("Retry");
    setLocale("zh-CN");
  });
});
