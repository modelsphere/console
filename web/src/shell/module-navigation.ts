import { matchPath } from "react-router";
import type { ConsoleModule, NavGroup, NavItem } from "./module";
import { applicationNavigation } from "./application-navigation";
import { entryItem, entryRegistry, entryVisible } from "./navigation-registry";

export function navGroups(modules: ConsoleModule[], has: (permission: string) => boolean): NavGroup[] {
  return applicationNavigation(modules, has, "/").groups;
}

export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap(item => [item, ...flattenNavItems(item.children ?? [])]);
}

export function topbarItems(modules: ConsoleModule[], has: (permission: string) => boolean): NavItem[] {
  const entries = entryRegistry(modules);
  return entries.filter(entry => entry.page.topbar && entryVisible(entry, entries, has)).map(entry => {
    const item = entryItem(entry);
    const topbar = typeof entry.page.topbar === "object" ? entry.page.topbar : undefined;
    return { ...item, label: topbar?.label ?? item.label, key: item.key + (topbar ? "Topbar" : "") };
  });
}

function activeGroup(groups: NavGroup[], pathname: string): NavGroup | undefined {
  return groups.flatMap(group => (group.paths ?? []).map(path => ({ group, path })))
    .filter(item => item.group.title && matchPath({ path: item.path, end: true }, pathname))
    .sort((left, right) => routeSpecificity(right.path) - routeSpecificity(left.path))[0]?.group
    ?? groups.find(group => group.title && group.basePath && (pathname === group.basePath || pathname.startsWith(group.basePath + "/")));
}

export function activeGroupKey(groups: NavGroup[], pathname: string): string | undefined {
  const group = activeGroup(groups, pathname);
  return group?.id ?? group?.title;
}

export function activeGroupTitle(groups: NavGroup[], pathname: string): string | undefined {
  return activeGroup(groups, pathname)?.title;
}

export function activeNavItem(items: NavItem[], pathname: string): NavItem | undefined {
  return flattenNavItems(items).filter(item => matchPath({ path: item.to, end: item.to === "/" }, pathname))
    .sort((left, right) => routeSpecificity(right.to) - routeSpecificity(left.to))[0];
}

export function routeSpecificity(path: string): number {
  const segments = path.split("/");
  return segments.length + segments.reduce((score, segment) => score + (segment === "*" ? -2 : segment.startsWith(":") ? 3 : segment ? 10 : 1), 0);
}
