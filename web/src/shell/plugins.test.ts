import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlugins } from "@/shell/plugins";
import { navGroups, type ConsoleModule } from "@/shell/module";
import type { FrontendNode } from "./plugin-tree";
import type { InstalledPlugin } from "@/shell/global-sdk/runtime";
import { importDevelopmentEntry } from "./plugin-development";
vi.mock("./plugin-development", () => ({ importDevelopmentEntry: vi.fn() }));

const builtin: ConsoleModule = { id: "core", title: "Core", basePath: "/core", pages: [] };
const example = (id = "example"): InstalledPlugin => ({ id, entry: `/plugins/${id}/index.umd.js`, menu: { title: "Tools", label: "Example", path: `/${id}`, component: "Example" } });

class Asset {
  src = ""; href = ""; rel = ""; type = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  remove = vi.fn();
}
function browser(installed: FrontendNode[], execute: (asset: Asset) => void) {
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("configured SDK plugins", () => {
  it("keeps only the shell with an explicitly empty plugin list", async () => {
    browser([], () => {});
    expect(await loadPlugins([builtin])).toEqual({ modules: [], errors: [] });
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
    ["slots", () => { register(); window.__MODELSPHERE_SDK__.registerSlot(); }, /slots/],
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


describe("configured frontend tree", () => {
  it("interleaves built-ins and SDK plugins in YAML order inside nested folders", async () => {
    browser([{ folder: "workloads", title: "模型与实验", children: [
      { id: "core", source: "builtin" },
      { folder: "experiments", title: "实验", children: [{ ...example(), source: "remote" }] },
    ] }], (asset) => { register(); asset.onload?.(); });
    const extra = { ...builtin, id: "unused", basePath: "/unused" };
    const result = await loadPlugins([extra, builtin]);
    expect(result.errors).toEqual([]);
    expect(result.modules.map((module) => module.id)).toEqual(["core", "example"]);
    expect(result.modules[1].navigationFolders).toEqual([{ id: "workloads", title: "模型与实验" }, { id: "experiments", title: "实验" }]);
    expect(builtin.navigationFolders).toBeUndefined();
  });

  it("supports remote-first explicit configuration and omits unconfigured built-ins", async () => {
    browser([{ ...example(), source: "remote" }], (asset) => { register(); asset.onload?.(); });
    expect((await loadPlugins([builtin])).modules.map((module) => module.id)).toEqual(["example"]);
  });

  it("keeps configured built-ins when a remote sibling fails and reports unknown built-ins", async () => {
    browser([{ id: "missing", source: "builtin" }, { ...example(), source: "remote" }, { id: "core", source: "builtin" }], (asset) => asset.onerror?.());
    const result = await loadPlugins([builtin]);
    expect(result.modules.map((module) => module.id)).toEqual(["core"]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Unknown built-in");
  });
});


describe("frontend discovery integrity", () => {
  it("does not enable the compiled registry when discovery fails", async () => {
    browser([], () => {});
    vi.mocked(fetch).mockRejectedValueOnce(new Error("discovery unavailable"));
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([]);
    expect(result.errors[0]).toContain("discovery unavailable");
  });

  it.each([false, true])("rejects builtin/remote path collisions before executing assets, reversed=%s", async (reversed) => {
    const nodes: FrontendNode[] = [{ id: "core", source: "builtin" }, { ...example(), source: "remote", menu: { ...example().menu, path: "/core" } }];
    const assets = browser(reversed ? nodes.reverse() : nodes, () => {});
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([]);
    expect(result.errors[0]).toContain("already taken");
    expect(assets).toEqual([]);
  });
});
