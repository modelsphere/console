import { matchPath } from "react-router";
import { LayoutDashboard } from "lucide-react";
import { pageKey } from "./i18n";
import { pagePath, type ConsoleModule, type ModulePage, type NavGroup, type NavItem } from "./module";

function menuOwner(module: ConsoleModule, page: ModulePage): ModulePage["menu"] {
  return page.menu ?? module.pages.filter(candidate => candidate.menu && matchPath({ path: pagePath(module, candidate), end: false }, pagePath(module, page)))
    .sort((left, right) => routeSpecificity(pagePath(module, right)) - routeSpecificity(pagePath(module, left)))[0]?.menu;
}

function groupedItems(items: NavItem[]): NavItem[] {
  const groups = new Map<string, NavItem[]>();
  for (const item of [...items].sort((left, right) => (left.order ?? 999) - (right.order ?? 999))) {
    const key = item.group ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
    if (item.children) item.children = groupedItems(item.children);
  }
  return [...groups.values()].flat();
}

function navItem(module: ConsoleModule, page: ModulePage, placement: "menu" | "topbar" = "menu"): NavItem {
  const topbar = placement === "topbar" && typeof page.topbar === "object" ? page.topbar : undefined;
  return {
    to: pagePath(module, page), label: topbar?.label ?? page.menu!.label, ns: module.id,
    key: (page.menu!.key ?? pageKey(page.path)) + (topbar ? "Topbar" : ""), icon: page.menu!.icon,
    end: page.path === "", group: page.menu!.group, order: page.menu!.order,
  };
}

function visibleMenus(module: ConsoleModule, has: (permission: string) => boolean): ModulePage[] {
  const pages = new Map(module.pages.filter(page => page.menu).map(page => [pagePath(module, page), page]));
  const visible = (page: ModulePage, seen = new Set<ModulePage>()): boolean => {
    if (seen.has(page) || page.menu?.hidden || (page.permission && !has(page.permission))) return false;
    seen.add(page);
    const parent = page.menu?.treeParent ? pages.get(page.menu.treeParent) : undefined;
    return !parent || visible(parent, seen);
  };
  return [...pages.values()].filter(page => visible(page));
}

function moduleItems(module: ConsoleModule, has: (permission: string) => boolean): { item: NavItem; owner: string }[] {
  const pages = visibleMenus(module, has);
  const items = new Map(pages.map(page => [pagePath(module, page), navItem(module, page)]));
  const entries: { item: NavItem; owner: string }[] = [];
  for (const page of pages) {
    const item = items.get(pagePath(module, page))!;
    const parent = page.menu?.treeParent ? items.get(page.menu.treeParent) : undefined;
    const parentPage = parent ? pages.find(candidate => pagePath(module, candidate) === parent.to) : undefined;
    const owner = page.menu?.parent ?? module.id;
    if (parent && owner === (parentPage?.menu?.parent ?? module.id)) (parent.children ??= []).push(item);
    else entries.push({ item, owner });
  }
  return entries;
}

export function navGroups(modules: ConsoleModule[], has: (permission: string) => boolean): NavGroup[] {
  const overview: NavGroup = { items: [{ to: "/", label: "概览", ns: "shell", key: "overview", icon: LayoutDashboard, end: true }] };
  const groups = new Map(modules.map(module => [module.id, {
    title: module.title, ns: module.id, basePath: module.basePath, items: [] as NavItem[], paths: [] as string[],
  }]));
  for (const module of modules) {
    for (const page of module.pages) groups.get(menuOwner(module, page)?.parent ?? module.id)?.paths.push(pagePath(module, page));
    for (const { item, owner } of moduleItems(module, has)) groups.get(owner)?.items.push(item);
  }
  return [overview, ...[...groups.values()].filter(group => group.items.length).map(group => ({ ...group, items: groupedItems(group.items) }))];
}

export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap(item => [item, ...flattenNavItems(item.children ?? [])]);
}

export function topbarItems(modules: ConsoleModule[], has: (permission: string) => boolean): NavItem[] {
  return modules.flatMap(module => visibleMenus(module, has).filter(page => page.topbar).map(page => navItem(module, page, "topbar")));
}

export function activeGroupTitle(groups: NavGroup[], pathname: string): string | undefined {
  return groups.flatMap(group => (group.paths ?? []).map(path => ({ group, path })))
    .filter(item => item.group.title && matchPath({ path: item.path, end: true }, pathname))
    .sort((left, right) => routeSpecificity(right.path) - routeSpecificity(left.path))[0]?.group.title
    ?? groups.find(group => group.title && group.basePath && (pathname === group.basePath || pathname.startsWith(group.basePath + "/")))?.title;
}

export function activeNavItem(items: NavItem[], pathname: string): NavItem | undefined {
  return flattenNavItems(items).filter(item => matchPath({ path: item.to, end: item.to === "/" }, pathname))
    .sort((left, right) => routeSpecificity(right.to) - routeSpecificity(left.to))[0];
}

export function routeSpecificity(path: string): number {
  const segments = path.split("/");
  return segments.length + segments.reduce((score, segment) => score + (segment === "*" ? -2 : segment.startsWith(":") ? 3 : segment ? 10 : 1), 0);
}
