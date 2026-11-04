import * as React from "react";
import * as Router from "react-router";
import * as Query from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import * as shell from "@/shell";
import { validateModules, type ConsoleModule } from "@/shell/module";

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

interface InstalledPlugin {
  id: string;
  entry: string;
  styles?: string[];
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

export async function loadPlugins(builtins: ConsoleModule[]): Promise<{ modules: ConsoleModule[]; errors: string[] }> {
  const modules = [...builtins];
  const errors: string[] = [];
  let register: (module: ConsoleModule) => void = () => { throw new Error("Plugins must register while their entry is loading"); };
  window.ConsolePluginHost = { version: 1, React, Router, Query, icons: { Boxes }, shell, register: (module) => register(module) };

  try {
    const response = await fetch("/plugins/index.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Plugin discovery failed (HTTP ${response.status})`);
    const installed: InstalledPlugin[] = await response.json();
    for (const plugin of installed) {
      const assets: HTMLElement[] = [];
      let registered: ConsoleModule | undefined;
      let registrationError: unknown;
      try {
        register = (module) => {
          try {
            if (registered) throw new Error(`Plugin "${plugin.id}" registered more than one module`);
            if (module.id !== plugin.id) throw new Error(`Plugin "${plugin.id}" registered module "${module.id}"`);
            validateModules([...modules, module]);
            registered = module;
          } catch (error) {
            registrationError = error;
          }
        };
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
        if (registrationError) throw registrationError;
        if (!registered) throw new Error("Entry did not register a module");
        modules.push(registered);
      } catch (error) {
        assets.forEach((asset) => asset.remove());
        errors.push(`${plugin.id}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        register = () => { throw new Error("Plugins must register synchronously from their entry"); };
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { modules, errors };
}
