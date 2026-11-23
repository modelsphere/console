import type { ComponentType } from "react";
import type { ConsoleModule } from "@/shell/module";

export interface ResourceExtensionContext<T = unknown> {
  resourceType: string;
  resourceKey: string;
  resource: T;
  data: Record<string, unknown>;
}

export interface ResourceDataExtension<T = unknown> {
  plugin: string;
  id: string;
  resourceType: string;
  load: (context: Omit<ResourceExtensionContext<T>, "data">) => Promise<unknown> | unknown;
}

export interface ResourceVisibilityExtension<T = unknown> {
  plugin: string;
  id: string;
  resourceType: string;
  placement: string;
  evaluate: (context: ResourceExtensionContext<T>) => boolean;
}

export interface ResourcePresentationProps<T = unknown> extends ResourceExtensionContext<T> {
  data: Record<string, unknown>;
}

export interface ResourcePresentationExtension<T = unknown> {
  plugin: string;
  id: string;
  resourceType: string;
  placement: string;
  key: string;
  component: ComponentType<ResourcePresentationProps<T>>;
}

export interface ResourceActionContext<T = unknown> extends ResourceExtensionContext<T> {
  action: string;
}

export interface ResourceActionExtension<T = unknown> {
  plugin: string;
  id: string;
  resourceType: string;
  action: string;
  evaluate: (context: ResourceActionContext<T>) => false | string;
}

export interface ConsoleExtensions {
  modules: ConsoleModule[];
  data: ResourceDataExtension[];
  visibility: ResourceVisibilityExtension[];
  presentations: ResourcePresentationExtension[];
  actions: ResourceActionExtension[];
}
