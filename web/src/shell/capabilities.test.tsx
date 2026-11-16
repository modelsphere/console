import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CapabilityContext, CapabilityGuard, availableModules, type CapabilityState } from "@/shell/capabilities";
import { canaryModule } from "@/modules/canary";
import { navGroups, type ConsoleModule } from "@/shell/module";
import { setLocale } from "@/shell/i18n";

const other: ConsoleModule = { id: "other", title: "Other", basePath: "/other", pages: [] };
const state = (configured: boolean, canRead: boolean, canWrite: boolean): CapabilityState => ({ loading: false, failed: false, retry: vi.fn(), data: { canary: { configured, canRead, canWrite } } });
const render = (value: CapabilityState, write = false) => renderToStaticMarkup(
  <CapabilityContext.Provider value={value}><CapabilityGuard capability="canary" write={write}><span>Protected content</span></CapabilityGuard></CapabilityContext.Provider>,
);

describe("optional module navigation and direct routes", () => {
  it.each([undefined, state(false, false, false).data, state(true, false, false).data])("hides Canary without configuration/read access while keeping other modules", (data) => {
    expect(availableModules([other, canaryModule], data)).toEqual([other]);
  });

  it("reader sees list/pricing navigation and can open existing experiments", () => {
    const value = state(true, true, false);
    const modules = availableModules([canaryModule], value.data);
    expect(navGroups(modules, () => true).flatMap((g) => g.items).map((i) => i.to)).toEqual(["/", "/canary", "/canary/pricing"]);
    expect(render(value)).toContain("Protected content");
    expect(render(value, true)).not.toContain("Protected content");
  });

  it("writer sees create navigation and write routes", () => {
    const value = state(true, true, true);
    expect(navGroups(availableModules([canaryModule], value.data), () => true).flatMap((g) => g.items).map((i) => i.to)).toContain("/canary/new");
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
