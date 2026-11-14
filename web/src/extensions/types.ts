import type { ComponentType } from "react";
import type { ConsoleModule } from "@/shell/module";
import type { ServiceOwner } from "@swiss/lib/api";

export interface ServiceOwnerProps {
  owner: ServiceOwner;
  compact?: boolean;
  assigned?: boolean;
}

export interface ServiceOwnerExtension {
  plugin: string;
  apiVersion: string;
  kind: string;
  component: ComponentType<ServiceOwnerProps>;
}

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

export interface ConsoleExtensions {
  modules: ConsoleModule[];
  serviceOwners: ServiceOwnerExtension[];
  data: ResourceDataExtension[];
  visibility: ResourceVisibilityExtension[];
  presentations: ResourcePresentationExtension[];
}
