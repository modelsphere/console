import * as React from "react";
import { useLocation, useParams } from "react-router";
import { Boxes, FlaskConical, Puzzle } from "lucide-react";
import { type ConsoleModule, type ModulePage } from "@/shell/module";
import {
  registerDataExtension,
  registerPresentationExtension,
  registerServiceOwnerExtension,
  registerVisibilityExtension,
} from "@/extensions/registry";
import type {
  ResourceDataExtension,
  ResourcePresentationExtension,
  ResourceVisibilityExtension,
  ServiceOwnerExtension,
} from "@/extensions/types";

export interface PluginMenu {
  title: string;
  label: string;
  path: string;
  component: string;
  icon?: string;
  capability?: string;
  requiresWrite?: boolean;
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
type PluginComponent = React.ComponentType<any>;
interface DataDefinition extends Omit<ResourceDataExtension, "plugin"> {}
interface VisibilityDefinition extends Omit<ResourceVisibilityExtension, "plugin"> {}
interface PresentationDefinition extends Omit<ResourcePresentationExtension, "plugin" | "component"> { component: string }
interface ServiceOwnerDefinition extends Omit<ServiceOwnerExtension, "plugin" | "component"> { component: string }
interface Registration {
  plugin: InstalledPlugin;
  definition?: Definition;
  components: Record<string, PluginComponent>;
  routes: Record<string, PluginComponent>;
  data: DataDefinition[];
  visibility: VisibilityDefinition[];
  presentations: PresentationDefinition[];
  serviceOwners: ServiceOwnerDefinition[];
  cleanups: (() => void)[];
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
  const pages: ModulePage[] = [{ path: "", element: <RoutePage component={component} />, requiresWrite: menu.requiresWrite,
    menu: { label: menu.label, icon: icons[menu.icon as keyof typeof icons] ?? Puzzle } }];
  for (const [pattern, route] of Object.entries(routes)) {
    const path = routePath(pattern);
    pages.push({ path, element: <RoutePage component={route} /> });
  }
  return { id: plugin.id, title: menu.title, basePath: menu.path, capability: menu.capability, frame: "flush", pages };
}

function registerExtensions(registration: Registration): void {
  for (const extension of registration.data) {
    registration.cleanups.push(registerDataExtension({ ...extension, plugin: registration.plugin.id }));
  }
  for (const extension of registration.visibility) {
    registration.cleanups.push(registerVisibilityExtension({ ...extension, plugin: registration.plugin.id }));
  }
  for (const extension of registration.presentations) {
    const component = registration.components[extension.component];
    if (!component) throw new Error(`Presentation component "${extension.component}" was not registered`);
    registration.cleanups.push(registerPresentationExtension({ ...extension, plugin: registration.plugin.id, component }));
  }
  for (const extension of registration.serviceOwners) {
    const component = registration.components[extension.component];
    if (!component) throw new Error(`Service owner component "${extension.component}" was not registered`);
    registration.cleanups.push(registerServiceOwnerExtension({ ...extension, plugin: registration.plugin.id, component }));
  }
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
    registerDataExtension(name: string, extension: DataDefinition) {
      record(name, (registration) => {
        if (registration.data.some((item) => item.id === extension.id)) throw new Error(`Data extension "${extension.id}" registered twice`);
        registration.data.push(extension);
      });
    },
    registerVisibilityExtension(name: string, extension: VisibilityDefinition) {
      record(name, (registration) => {
        if (registration.visibility.some((item) => item.id === extension.id)) throw new Error(`Visibility extension "${extension.id}" registered twice`);
        registration.visibility.push(extension);
      });
    },
    registerPresentationExtension(name: string, extension: PresentationDefinition) {
      record(name, (registration) => {
        if (registration.presentations.some((item) => item.id === extension.id)) throw new Error(`Presentation extension "${extension.id}" registered twice`);
        registration.presentations.push(extension);
      });
    },
    registerServiceOwnerExtension(name: string, extension: ServiceOwnerDefinition) {
      record(name, (registration) => {
        if (registration.serviceOwners.some((item) => item.apiVersion === extension.apiVersion && item.kind === extension.kind)) {
          throw new Error(`Service owner extension "${extension.apiVersion}/${extension.kind}" registered twice`);
        }
        registration.serviceOwners.push(extension);
      });
    },
    getPluginComponents: (name: string) => current?.plugin.id === name ? current.components : installed.get(name) ?? {},
    registerSlot(slot?: { plugin?: string; target?: string; resourceType?: string; placement?: string }) {
      if (!current || !slot) return;
      const { resourceType, placement, target } = slot;
      if (!resourceType || !placement || !target) return;
      sdk.registerPresentationExtension(current.plugin.id, {
        id: target,
        resourceType,
        placement,
        key: target,
        component: target,
      });
    },
  };
  return {
    sdk,
    begin(plugin: InstalledPlugin) { current = { plugin, components: {}, routes: {}, data: [], visibility: [], presentations: [], serviceOwners: [], cleanups: [] }; },
    finish() {
      if (!current) throw new Error("No SDK entry is loading");
      const module = buildModule(current);
      registerExtensions(current);
      return module;
    },
    commit() { if (current) installed.set(current.plugin.id, current.components); },
    rollback() { current?.cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); },
    end() { current = undefined; },
  };
}
