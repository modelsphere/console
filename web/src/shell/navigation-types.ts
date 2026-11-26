import type { LucideIcon } from "lucide-react";
import type { ModulePage } from "./module";

export interface NavigationScope {
  scope: "platform" | "cluster";
  title: string;
  icon: LucideIcon;
  path?: string;
}

export interface EntryReference {
  provider: string;
  entry: string;
  scope?: string;
  viewport?: string;
}

export interface CompositionGroup {
  name: string;
  title: string;
  ns?: string;
  menus: EntryReference[];
}

export interface HostNavigation {
  groups: CompositionGroup[];
}

interface ApplicationComposition extends HostNavigation {
  scopes?: NavigationScope[];
  launcher?: boolean;
}

export interface ModuleNavigation {
  provider: string;
  entries: { name: string; path: string; menu?: ModulePage["menu"] }[];
  menus: string[];
  scopes: NavigationScope[];
  composition?: ApplicationComposition;
}
