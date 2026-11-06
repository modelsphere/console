import * as React from "react";
import { useLocation, useParams } from "react-router";
import { Boxes, FlaskConical, Puzzle } from "lucide-react";
import { type ConsoleModule, type ModulePage } from "@/shell/module";

export interface PluginMenu {
  title: string;
  label: string;
  path: string;
  component: string;
  icon?: string;
}

export interface InstalledPlugin {
  id: string;
  entry: string;
  styles?: string[];
  menu: PluginMenu;
  development?: boolean;
}

interface SDKMenu { name: string; path: string; authKey?: string }
interface Definition { name: string; version: string; menus?: SDKMenu[] }
interface RouteProps { params: Record<string, string | undefined>; locationSearch: string }
type PluginComponent = React.ComponentType<RouteProps>;
interface Registration {
  plugin: InstalledPlugin;
  definition?: Definition;
  components: Record<string, PluginComponent>;
  routes: Record<string, PluginComponent>;
  error?: Error;
}

function RoutePage({ component: Component }: { component: PluginComponent }) {
  return <Component params={useParams()} locationSearch={useLocation().search} />;
}

function routePath(pattern: string): string {
  const normalized = pattern.replace(/^\//, "").replace(/\[\.\.\.([\w-]+)\]/g, "*").replace(/\[([\w-]+)\]/g, ":$1");
  if (!normalized || normalized.split("/").some((part) => !/^(?:[\w-]+|:[\w-]+|\*)$/.test(part))) {
    throw new Error(`Unsupported SDK route "${pattern}"`);
  }
  return normalized;
}

function buildModule(registration: Registration): ConsoleModule {
  const { plugin, definition, components, routes, error } = registration;
  if (error) throw error;
  if (!definition || !plugin.menu) throw new Error("Entry did not register a ModelSphere SDK plugin");
  const menu = plugin.menu;
  const component = components[menu.component];
  if (!component) throw new Error(`Menu component "${menu.component}" was not registered`);
  const icons = { boxes: Boxes, "flask-conical": FlaskConical, puzzle: Puzzle };
  if (menu.icon && !(menu.icon in icons)) throw new Error(`Unsupported menu icon "${menu.icon}"`);
  const pages: ModulePage[] = [{ path: "", element: <RoutePage component={component} />,
    menu: { label: menu.label, icon: icons[menu.icon as keyof typeof icons] ?? Puzzle } }];
  for (const [pattern, route] of Object.entries(routes)) {
    const path = routePath(pattern);
    pages.push({ path, element: <RoutePage component={route} /> });
  }
  return { id: plugin.id, title: menu.title, basePath: menu.path, frame: "flush", pages };
}

export function createRegistration() {
  let current: Registration | undefined;
  const installed = new Map<string, Record<string, PluginComponent>>();
  function record(name: string, action: (registration: Registration) => void) {
    if (!current) throw new Error("SDK registration is only available while an entry loads");
    try {
      if (name !== current.plugin.id) throw new Error(`Plugin "${current.plugin.id}" registered "${name}"`);
      action(current);
    } catch (error) { current.error ??= error instanceof Error ? error : new Error(String(error)); }
  }
  const sdk = {
    registerPlugin(definition: Definition) {
      record(definition.name, (registration) => {
        if (registration.definition) throw new Error("Entry registered more than one plugin");
        registration.definition = definition;
      });
    },
    registerPluginComponent(name: string, key: string, component: unknown) {
      record(name, (registration) => {
        if (registration.components[key]) throw new Error(`Component "${key}" registered twice`);
        if (typeof component !== "function" && !(component && typeof component === "object" && "$$typeof" in component)) throw new Error(`Invalid component "${key}"`);
        registration.components[key] = component as PluginComponent;
      });
    },
    registerPluginRoutes(name: string, routes: Record<string, unknown>) {
      record(name, (registration) => {
        for (const [pattern, component] of Object.entries(routes)) {
          if (typeof component !== "function" && !(component && typeof component === "object" && "$$typeof" in component)) throw new Error(`Invalid route "${pattern}"`);
          if (registration.routes[pattern]) throw new Error(`Route "${pattern}" registered twice`);
          registration.routes[pattern] = component as PluginComponent;
        }
      });
    },
    getPluginComponents: (name: string) => current?.plugin.id === name ? current.components : installed.get(name) ?? {},
    registerSlot() { if (current) current.error = new Error("This Console host does not support SDK slots"); },
  };
  return {
    sdk,
    begin(plugin: InstalledPlugin) { current = { plugin, components: {}, routes: {} }; },
    finish() { if (!current) throw new Error("No SDK entry is loading"); return buildModule(current); },
    commit() { if (current) installed.set(current.plugin.id, current.components); },
    end() { current = undefined; },
  };
}
