import { matchPath } from "react-router";
import { pageKey } from "./i18n";
import { pagePath, routeSpecificity, type ConsoleModule, type ModulePage, type NavItem } from "./module";
import type { ModuleNavigation } from "./navigation-types";

export interface RegisteredEntry {
  id: string;
  name: string;
  provider: string;
  module: ConsoleModule;
  page: ModulePage;
  menu: NonNullable<ModulePage["menu"]>;
  path: string;
  legacy: boolean;
}

export function moduleNavigation(module: ConsoleModule): ModuleNavigation {
  return module.navigation ?? {
    provider: `console/${module.id}`, scopes: [],
    entries: module.pages.filter(page => page.menu).map(page => ({ name: page.menu!.key ?? pageKey(page.path), path: pagePath(module, page) })),
    menus: module.pages.filter(page => page.menu).map(page => page.menu!.key ?? pageKey(page.path)),
  };
}

export function entryRegistry(modules: ConsoleModule[]): RegisteredEntry[] {
  return modules.flatMap(module => {
    const navigation = moduleNavigation(module);
    const pages = new Map(module.pages.map(page => [pagePath(module, page), page]));
    return navigation.entries.flatMap(declaration => {
      const page = pages.get(declaration.path);
      return page?.menu ? [{
        id: `${navigation.provider}/${declaration.name}`, name: declaration.name, provider: navigation.provider,
        module, page, menu: declaration.menu ?? page.menu, path: declaration.path, legacy: navigation.menus.includes(declaration.name),
      }] : [];
    });
  });
}

export function entryVisible(entry: RegisteredEntry, entries: RegisteredEntry[], has: (permission: string) => boolean, seen = new Set<string>()): boolean {
  if (seen.has(entry.id) || entry.menu.hidden || (entry.page.permission && !has(entry.page.permission))) return false;
  seen.add(entry.id);
  const parent = entries.find(candidate => candidate.module.id === entry.module.id && candidate.path === entry.menu.treeParent);
  return !parent || entryVisible(parent, entries, has, seen);
}

export function entryItem(entry: RegisteredEntry): NavItem {
  return {
    to: entry.path, label: entry.menu.label, ns: entry.module.id, key: entry.menu.key ?? pageKey(entry.page.path),
    icon: entry.menu.icon, end: entry.page.path === "", group: entry.menu.group, order: entry.menu.order,
  };
}

export function routeEntry(module: ConsoleModule, page: ModulePage, entries: RegisteredEntry[]): RegisteredEntry | undefined {
  const path = pagePath(module, page);
  return entries.filter(entry => entry.module.id === module.id && matchPath({ path: entry.path, end: false }, path))
    .sort((left, right) => routeSpecificity(right.path) - routeSpecificity(left.path))[0];
}
