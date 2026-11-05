import * as React from "react";
import * as Router from "react-router";
import * as Query from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import * as shell from "@/shell";
import { validateModules, type ConsoleModule } from "@/shell/module";
import { createGlobalHost } from "@/shell/global-sdk/host";
import type { InstalledPlugin } from "@/shell/global-sdk/runtime";

export interface ConsolePluginHost {
  version: 1;
  React: typeof React;
  Router: typeof Router;
  Query: typeof Query;
  icons: { Boxes: typeof Boxes };
  shell: typeof shell;
  register(module: ConsoleModule): void;
}

declare global {
  interface Window {
    ConsolePluginHost: ConsolePluginHost;
  }
}

function loadAsset(asset: HTMLScriptElement | HTMLLinkElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("Plugin asset loading timed out")), 15_000);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      asset.onload = null;
      asset.onerror = null;
      if (error) reject(error);
      else resolve();
    }
    asset.onload = () => finish();
    asset.onerror = () => finish(new Error(`Cannot load ${asset instanceof HTMLScriptElement ? asset.src : asset.href}`));
    document.head.append(asset);
  });
}

function moduleRegistration(plugin: InstalledPlugin) {
  let module: ConsoleModule | undefined;
  let error: unknown;
  return {
    register(value: ConsoleModule) {
      try {
        if (module) throw new Error(`Plugin "${plugin.id}" registered more than one module`);
        if (value.id !== plugin.id) throw new Error(`Plugin "${plugin.id}" registered module "${value.id}"`);
        module = value;
      } catch (cause) { error = cause; }
    },
    finish() {
      if (error) throw error;
      if (!module) throw new Error("Entry did not register a module");
      return module;
    },
  };
}

async function loadEntryAssets(plugin: InstalledPlugin, assets: HTMLElement[]) {
  for (const href of plugin.styles ?? []) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    assets.push(link);
    await loadAsset(link);
  }
  const script = document.createElement("script");
  script.src = plugin.entry;
  assets.push(script);
  await loadAsset(script);
}

async function loadEntry(plugin: InstalledPlugin, modules: ConsoleModule[], runtime: ReturnType<typeof createGlobalHost>) {
  const assets: HTMLElement[] = [];
  const legacy = moduleRegistration(plugin);
  try {
    if (plugin.menu) runtime.begin(plugin);
    window.ConsolePluginHost.register = legacy.register;
    await loadEntryAssets(plugin, assets);
    const module = plugin.menu ? runtime.finish() : legacy.finish();
    validateModules([...modules, module]);
    modules.push(module);
    if (plugin.menu) runtime.commit();
  } catch (error) {
    assets.forEach((asset) => asset.remove());
    throw error;
  } finally {
    runtime.end();
    window.ConsolePluginHost.register = () => { throw new Error("Plugins must register synchronously from their entry"); };
  }
}

export async function loadPlugins(builtins: ConsoleModule[]): Promise<{ modules: ConsoleModule[]; errors: string[] }> {
  const modules = [...builtins];
  const errors: string[] = [];
  window.ConsolePluginHost = { version: 1, React, Router, Query, icons: { Boxes }, shell,
    register: () => { throw new Error("Plugins must register while their entry is loading"); } };
  const runtime = createGlobalHost();
  window.__GLOBAL_SDK__ = window.__RISE_SDK__ = runtime.host;
  try {
    const response = await fetch("/plugins/index.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Plugin discovery failed (HTTP ${response.status})`);
    const installed: InstalledPlugin[] = await response.json();
    for (const plugin of installed) {
      try { await loadEntry(plugin, modules, runtime); }
      catch (error) { errors.push(`${plugin.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { modules, errors };
}
