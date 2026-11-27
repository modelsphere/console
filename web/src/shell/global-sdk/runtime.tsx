import * as React from "react";
import { buildModule, type Definition } from "./navigation";
import { compositionModule, type NavigationComposition } from "./composition";
import { scopeForPath } from "./scope";
import type { HelpChapterRegistration } from "../../../packages/plugin-sdk/src/types";
import { registerPluginHelpChapter, validateHelpChapter } from "@/modules/docs/plugin-chapters";
import {
  registerActionExtension,
  registerDataExtension,
  registerPresentationExtension,
  registerVisibilityExtension,
} from "@/extensions/registry";
import type {
  ResourceActionExtension,
  ResourceDataExtension,
  ResourcePresentationExtension,
  ResourceVisibilityExtension,
} from "@/extensions/types";

export interface InstalledPlugin {
  id: string;
  group?: string;
  version?: string;
  entry: string;
  styles?: string[];
  backend?: { name: string; prefix: string; writePermission?: string };
}

type PluginComponent = React.ComponentType<any>;
interface DataDefinition extends Omit<ResourceDataExtension, "plugin"> {}
interface VisibilityDefinition extends Omit<ResourceVisibilityExtension, "plugin"> {}
interface PresentationDefinition extends Omit<ResourcePresentationExtension, "plugin" | "component" | "capability"> { component: string }
interface ActionDefinition extends Omit<ResourceActionExtension, "plugin"> {}
interface Registration {
  plugin: InstalledPlugin;
  definition?: Definition;
  composition?: NavigationComposition;
  components: Record<string, PluginComponent>;
  routes: Record<string, PluginComponent>;
  data: DataDefinition[];
  visibility: VisibilityDefinition[];
  presentations: PresentationDefinition[];
  actions: ActionDefinition[];
  helpChapters: HelpChapterRegistration[];
  cleanups: (() => void)[];
  error?: Error;
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
    registration.cleanups.push(registerPresentationExtension({
      ...extension, plugin: registration.plugin.id, capability: registration.plugin.backend?.name, component,
    }));
  }
  for (const extension of registration.actions) {
    registration.cleanups.push(registerActionExtension({ ...extension, plugin: registration.plugin.id }));
  }
  for (const chapter of registration.helpChapters) {
    registration.cleanups.push(registerPluginHelpChapter({
      ...chapter,
      plugin: registration.plugin.id,
      capability: registration.plugin.backend?.name,
      assetBase: registration.plugin.entry.slice(0, registration.plugin.entry.lastIndexOf("/") + 1),
    }));
  }
}

export function createRegistration() {
  let current: Registration | undefined;
  const installed = new Map<string, Registration>();
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
        if (registration.definition || registration.composition) throw new Error("Entry registered more than one plugin");
        registration.definition = definition;
      });
    },
    registerNavigationComposition(composition: NavigationComposition) {
      record(composition.name, (registration) => {
        if (registration.definition || registration.composition) throw new Error("Entry registered more than one plugin");
        compositionModule(composition);
        registration.composition = composition;
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
        if (extension.placement === "resource.tabs") {
          if (typeof extension.key !== "string" || !extension.key.trim() ||
              typeof extension.tab?.title !== "string" || !extension.tab.title.trim() ||
              (extension.tab.order !== undefined && !Number.isFinite(extension.tab.order))) {
            throw new Error(`Presentation extension "${extension.id}" requires a tab key, title, and optional finite order`);
          }
          if (registration.presentations.some((item) => item.resourceType === extension.resourceType &&
            item.placement === extension.placement && item.key === extension.key)) {
            throw new Error(`Tab key "${extension.key}" registered twice for resource "${extension.resourceType}"`);
          }
        }
        registration.presentations.push(extension);
      });
    },
    registerActionExtension(name: string, extension: ActionDefinition) {
      record(name, (registration) => {
        if (registration.actions.some((item) => item.id === extension.id)) throw new Error(`Action extension "${extension.id}" registered twice`);
        registration.actions.push(extension);
      });
    },
    registerHelpChapter(name: string, chapter: HelpChapterRegistration) {
      record(name, (registration) => {
        validateHelpChapter(name, chapter);
        if (registration.helpChapters.some((current) => current.slug === chapter.slug)) throw new Error(`Help chapter "${chapter.slug}" registered twice`);
        registration.helpChapters.push(chapter);
      });
    },
    getPluginComponents: (name: string) => current?.plugin.id === name ? current.components : installed.get(name)?.components ?? {},
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
    begin(plugin: InstalledPlugin) { current = { plugin, components: {}, routes: {}, data: [], visibility: [], presentations: [], actions: [], helpChapters: [], cleanups: [] }; },
    finish() {
      if (!current) throw new Error("No SDK entry is loading");
      if (current.error) throw current.error;
      const module = current.composition ? compositionModule(current.composition, `${current.plugin.group ?? "modelsphere.dev"}/${current.plugin.id}`) : buildModule(current);
      registerExtensions(current);
      return module;
    },
    commit() { if (current) installed.set(current.plugin.id, current); },
    getScope(path: string) { return scopeForPath(path, [...installed.values()].flatMap(registration => registration.definition ? [registration.definition] : [])); },
    rollback() { current?.cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); },
    end() { current = undefined; },
  };
}
