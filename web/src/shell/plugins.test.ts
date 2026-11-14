import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlugins } from "@/shell/plugins";
import { navGroups, type ConsoleModule } from "@/shell/module";
import type { InstalledPlugin } from "@/shell/global-sdk/runtime";
import { importDevelopmentEntry } from "./plugin-development";
import { extensions } from "@/extensions/registry";
vi.mock("./plugin-development", () => ({ importDevelopmentEntry: vi.fn() }));

const builtin: ConsoleModule = { id: "core", title: "Core", basePath: "/core", pages: [] };
const example = (id = "example"): InstalledPlugin => ({ id, entry: `/plugins/${id}/index.umd.js`, menu: { title: "Tools", label: "Example", path: `/${id}`, component: "Example" } });

class Asset {
  src = ""; href = ""; rel = ""; type = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  remove = vi.fn();
}
function browser(installed: InstalledPlugin[], execute: (asset: Asset) => void) {
  const assets: Asset[] = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("HTMLScriptElement", Asset);
  vi.stubGlobal("document", { createElement: () => new Asset(), head: { append(asset: Asset) { assets.push(asset); queueMicrotask(() => execute(asset)); } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
  return assets;
}
function register(id = "example") {
  const sdk = window.__MODELSPHERE_SDK__;
  sdk.registerPlugin({ name: id, version: "1.0.0", menus: [] });
  sdk.registerPluginComponent(id, "Example", () => null);
  sdk.registerPluginRoutes(id, { "items/[id]": () => null });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  extensions.data.length = 0;
  extensions.visibility.length = 0;
  extensions.presentations.length = 0;
  extensions.serviceOwners.length = 0;
});

describe("configured SDK plugins", () => {
  it("keeps the shell unchanged with no configured plugins", async () => {
    browser([], () => {});
    expect(await loadPlugins([builtin])).toEqual({ modules: [builtin], errors: [] });
  });
  it("shares SDK host aliases and registers the configured menu and dynamic routes", async () => {
    browser([example()], asset => { register(); asset.onload?.(); });
    const result = await loadPlugins([builtin]);
    expect(result.errors).toEqual([]);
    expect(window.__MODELSPHERE_SDK__).toBe(window.__GLOBAL_SDK__);
    expect(window.__MODELSPHERE_SDK__).toBe(window.__RISE_SDK__);
    expect(result.modules[1].pages.map(page => page.path)).toEqual(["", "items/:id"]);
    expect(navGroups(result.modules, () => false).at(-1)?.items[0].label).toBe("Example");
  });
  it("registers data, visibility, presentation and owner extensions", async () => {
    browser([example()], asset => {
      register();
      const sdk = window.__MODELSPHERE_SDK__;
      sdk.registerPluginComponent("example", "Owner", () => null);
      sdk.registerDataExtension("example", { id: "owner", resourceType: "inference-service", load: () => ({}) });
      sdk.registerVisibilityExtension("example", { id: "owner-visible", resourceType: "inference-service", placement: "resource.header", evaluate: () => true });
      sdk.registerPresentationExtension("example", { id: "owner-view", resourceType: "inference-service", placement: "resource.header", key: "owner", component: "Owner" });
      sdk.registerServiceOwnerExtension("example", { apiVersion: "example/v1", kind: "Owner", component: "Owner" });
      asset.onload?.();
    });
    expect((await loadPlugins([builtin])).errors).toEqual([]);
    expect(extensions.data.map(item => item.id)).toEqual(["owner"]);
    expect(extensions.visibility.map(item => item.id)).toEqual(["owner-visible"]);
    expect(extensions.presentations.map(item => item.id)).toEqual(["owner-view"]);
    expect(extensions.serviceOwners.map(item => item.kind)).toEqual(["Owner"]);
  });
  it("uses a classic bundle for deployment", async () => {
    const assets = browser([example()], asset => { register(); asset.onload?.(); });
    expect((await loadPlugins([builtin])).errors).toEqual([]);
    expect(assets[0].type).toBe("");
    expect(importDevelopmentEntry).not.toHaveBeenCalled();
  });
  it("waits for development bootstrap evaluation before completing registration", async () => {
    const assets = browser([{ ...example(), development: true }], () => {});
    let complete!: () => void;
    vi.mocked(importDevelopmentEntry).mockImplementation(() => new Promise(resolve => { complete = () => { register(); resolve(); }; }));
    const result = loadPlugins([builtin]);
    await vi.waitFor(() => expect(importDevelopmentEntry).toHaveBeenCalledWith(example().entry));
    complete();
    expect((await result).errors).toEqual([]);
    expect(assets).toEqual([]);
  });
  it("loads stylesheet assets before the entry", async () => {
    const assets = browser([{ ...example(), styles: ["/plugins/example/style.css"] }], asset => { if (asset.src) register(); asset.onload?.(); });
    expect((await loadPlugins([builtin])).errors).toEqual([]);
    expect(assets.map(asset => asset.href || asset.src)).toEqual(["/plugins/example/style.css", "/plugins/example/index.umd.js"]);
  });
  it.each([
    ["identity", () => register("other"), /registered/],
    ["missing component", () => window.__MODELSPHERE_SDK__.registerPlugin({name:"example",version:"1"}), /not registered/],
    ["missing presentation component", () => {
      register();
      window.__MODELSPHERE_SDK__.registerPresentationExtension("example", {
        id: "broken-view",
        resourceType: "inference-service",
        placement: "resource.header",
        key: "broken",
        component: "Missing",
      });
    }, /Presentation component/],
    ["duplicate registration", () => { register(); register(); }, /more than one/],
  ])("reports %s failures and removes failed assets", async (_name, execute, error) => {
    const assets = browser([example()], asset => { execute(); asset.onload?.(); });
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([builtin]);
    expect(result.errors[0]).toMatch(error);
    expect(assets[0].remove).toHaveBeenCalled();
  });
  it("rejects a menu that collides with a builtin", async () => {
    browser([{...example(),menu:{...example().menu,path:"/core"}}],asset=>{register();asset.onload?.();});
    expect((await loadPlugins([builtin])).errors[0]).toMatch(/already taken/);
  });
  it("continues after an entry asset fails", async () => {
    browser([example("broken"),example()],asset=>{if(asset.src.includes("broken"))asset.onerror?.();else{register();asset.onload?.();}});
    const result=await loadPlugins([builtin]);
    expect(result.modules.map(module=>module.id)).toEqual(["core","example"]);
    expect(result.errors[0]).toMatch(/broken/);
  });
  it("bounds stalled resource loading", async () => {
    vi.useFakeTimers();browser([example()],()=>{});
    const loading=loadPlugins([builtin]);await vi.advanceTimersByTimeAsync(15000);
    expect((await loading).errors[0]).toMatch(/timed out/);
  });
});
