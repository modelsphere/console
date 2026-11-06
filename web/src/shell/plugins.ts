import { validateModules, type ConsoleModule } from "@/shell/module";
import { createGlobalHost } from "@/shell/global-sdk/host";
import type { InstalledPlugin } from "@/shell/global-sdk/runtime";
import { importDevelopmentEntry } from "./plugin-development";

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

async function loadEntryAssets(plugin: InstalledPlugin, assets: HTMLElement[]) {
  for (const href of plugin.styles ?? []) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    assets.push(link);
    await loadAsset(link);
  }
  if (plugin.development) {
    await importDevelopmentEntry(plugin.entry);
    return;
  }
  const script = document.createElement("script");
  script.src = plugin.entry;
  assets.push(script);
  await loadAsset(script);
}

async function loadEntry(plugin: InstalledPlugin, modules: ConsoleModule[], runtime: ReturnType<typeof createGlobalHost>) {
  const assets: HTMLElement[] = [];
  try {
    runtime.begin(plugin);
    await loadEntryAssets(plugin, assets);
    const module = runtime.finish();
    validateModules([...modules, module]);
    modules.push(module);
    runtime.commit();
  } catch (error) {
    assets.forEach((asset) => asset.remove());
    throw error;
  } finally {
    runtime.end();
  }
}

export async function loadPlugins(builtins: ConsoleModule[]): Promise<{ modules: ConsoleModule[]; errors: string[] }> {
  const modules = [...builtins];
  const errors: string[] = [];
  const runtime = createGlobalHost();
  window.__MODELSPHERE_SDK__ = window.__GLOBAL_SDK__ = window.__RISE_SDK__ = runtime.host;
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
