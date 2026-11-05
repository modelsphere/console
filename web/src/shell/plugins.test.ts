import { afterEach, describe, expect, it, vi } from "vitest";
import { Boxes } from "lucide-react";
import { loadPlugins } from "@/shell/plugins";
import { navGroups, type ConsoleModule } from "@/shell/module";

const builtin: ConsoleModule = { id: "core", title: "Core", basePath: "/core", pages: [] };
const example = (id = "example"): ConsoleModule => ({
  id, title: "Example", basePath: `/${id}`,
  pages: [{ path: "", element: null, menu: { label: "Example", icon: Boxes } }],
});

class Asset {
  src = "";
  href = "";
  rel = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  remove = vi.fn();
}

function browser(installed: { id: string; entry: string; styles?: string[]; menu?: {title: string; label: string; path: string; component: string} }[], execute: (asset: Asset) => void) {
  const assets: Asset[] = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("HTMLScriptElement", Asset);
  vi.stubGlobal("document", {
    createElement: () => new Asset(),
    head: { append(asset: Asset) { assets.push(asset); queueMicrotask(() => execute(asset)); } },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
  return assets;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("installed plugins", () => {
  it("loads the Global SDK registration sequence with configured navigation and dynamic routes", async () => {
    const Component = () => null;
    browser([{ id: "example", entry: "/plugins/example/index.umd.js", menu: { title: "Tools", label: "Configured label", path: "/example", component: "Example" } }], (asset) => {
      const sdk = window.__GLOBAL_SDK__;
      expect(sdk).toBe(window.__RISE_SDK__);
      sdk.registerPlugin({ name: "example", version: "1.0.0", menus: [] });
      sdk.registerPluginComponent("example", "Example", Component);
      sdk.registerPluginRoutes("example", { "items/[id]": Component });
      asset.onload?.();
    });
    const result = await loadPlugins([builtin]);
    expect(result.errors).toEqual([]);
    expect(result.modules[1]).toMatchObject({ id: "example", title: "Tools", basePath: "/example" });
    expect(result.modules[1].pages.map((page) => page.path)).toEqual(["", "items/:id"]);
    expect(navGroups(result.modules, () => true).at(-1)?.items[0].label).toBe("Configured label");
    expect(navGroups(result.modules, () => false).at(-1)?.basePath).toBe("/example");
  });
  it("keeps uninstalled modules out of navigation without changing built-ins", async () => {
    const assets = browser([], () => {});
    const result = await loadPlugins([builtin]);
    expect(result).toEqual({ modules: [builtin], errors: [] });
    expect(assets).toHaveLength(0);
    expect(navGroups(result.modules, () => true).some((group) => group.basePath === "/example")).toBe(false);
  });

  it("loads remounted SDK routes without adding page permission gates", async () => {
    browser([{ id: "example", entry: "/plugins/example/index.umd.js", menu: { title: "Tools", label: "Example", path: "/tools", component: "Example" } }], (asset) => {
      const sdk = window.__GLOBAL_SDK__;
      sdk.registerPlugin({ name: "example", version: "1.0.0", menus: [{ name: "edit", path: "/example/items/[id]", authKey: "example.write" }] });
      sdk.registerPluginComponent("example", "Example", () => null);
      sdk.registerPluginRoutes("example", { "items/[id]": () => null });
      asset.onload?.();
    });
    const result = await loadPlugins([builtin]);
    expect(result.errors).toEqual([]);
    expect(result.modules[1].pages.map((page) => page.path)).toEqual(["", "items/:id"]);
    expect(result.modules[1].pages.every((page) => page.permission === undefined)).toBe(true);
  });

  it("loads CSS before registration and shares the host hooks and shell", async () => {
    const module = example();
    const assets = browser([{ id: "example", entry: "/plugins/example/index.js", styles: ["/plugins/example/style.css"] }], (asset) => {
      if (asset.src) window.ConsolePluginHost.register(module);
      asset.onload?.();
    });
    const result = await loadPlugins([builtin]);
    expect(result.errors).toEqual([]);
    expect(result.modules).toEqual([builtin, module]);
    expect(assets.map((asset) => asset.href || asset.src)).toEqual(["/plugins/example/style.css", "/plugins/example/index.js"]);
    expect(window.ConsolePluginHost.React.useState).toBeTypeOf("function");
    expect(window.ConsolePluginHost.shell.useAuth).toBeTypeOf("function");
    expect(navGroups(result.modules, () => true).at(-1)?.basePath).toBe("/example");
    expect(() => window.ConsolePluginHost.register(module)).toThrow(/synchronously/);
  });

  it.each([
    ["identity", () => example("other"), /registered module/],
    ["collision", () => ({ ...example(), basePath: "/core" }), /already taken/],
    ["reserved route", () => ({ ...example(), basePath: "/plugins" }), /reserved/],
  ])("reports a %s error without installing the module", async (_name, create, message) => {
    const assets = browser([{ id: "example", entry: "/plugins/example/index.js" }], (asset) => {
      window.ConsolePluginHost.register(create());
      asset.onload?.();
    });
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([builtin]);
    expect(result.errors[0]).toMatch(message);
    expect(assets[0].remove).toHaveBeenCalled();
  });

  it("rejects multiple registrations from a single package", async () => {
    browser([{ id: "example", entry: "/plugins/example/index.js" }], (asset) => {
      window.ConsolePluginHost.register(example());
      window.ConsolePluginHost.register(example());
      asset.onload?.();
    });
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([builtin]);
    expect(result.errors[0]).toMatch(/more than one/);
  });

  it("reports scripts that never register", async () => {
    browser([{ id: "example", entry: "/plugins/example/index.js" }], (asset) => asset.onload?.());
    const result = await loadPlugins([builtin]);
    expect(result.modules).toEqual([builtin]);
    expect(result.errors[0]).toMatch(/did not register/);
  });

  it("continues loading later plugins after an asset fails", async () => {
    browser([{ id: "broken", entry: "/plugins/broken/index.js" }, { id: "example", entry: "/plugins/example/index.js" }], (asset) => {
      if (asset.src.includes("broken")) asset.onerror?.();
      else { window.ConsolePluginHost.register(example()); asset.onload?.(); }
    });
    const result = await loadPlugins([builtin]);
    expect(result.modules.map((module) => module.id)).toEqual(["core", "example"]);
    expect(result.errors[0]).toMatch(/broken.*Cannot load/);
  });

  it("keeps the shell available when discovery fails", async () => {
    browser([], () => {});
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await loadPlugins([builtin])).toEqual({ modules: [builtin], errors: ["Plugin discovery failed (HTTP 500)"] });
  });

  it("bounds asset loading so a stalled plugin cannot indefinitely block startup", async () => {
    vi.useFakeTimers();
    browser([{ id: "example", entry: "/plugins/example/index.js" }], () => {});
    const loading = loadPlugins([builtin]);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await loading;
    expect(result.modules).toEqual([builtin]);
    expect(result.errors[0]).toMatch(/timed out/);
  });
});
