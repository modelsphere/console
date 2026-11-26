import type { ComponentType } from "react";
import { Navigate, matchPath, useLocation, useParams } from "react-router";
import { usePermissions } from "@/shell/permissions";
import { pagePath, routeSpecificity, type ConsoleModule, type ModulePage } from "@/shell/module";
import { entryRegistry, type RegisteredEntry } from "@/shell/navigation-registry";
import type { PluginNavigationComposition, UserMenuItemDefinition, UserMenuTarget } from "../../../packages/plugin-sdk/src/types";
import { compileNavigationComposition } from "./composition";
import { menuIcon } from "./icons";
import { absoluteRoute, pathNamespace, relativePath, routePath } from "./navigation-paths";
import type { InstalledPlugin } from "./runtime";
import { buildScopeDeclarations, type SDKScopeDeclaration } from "./scope-declarations";

export interface SDKMenu {
  name: string;
  path: string;
  title?: string;
  icon?: string;
  authKey?: string;
  hidden?: boolean;
  scope?: string;
  requiredScope?: string[];
  parent?: string;
  group?: string;
  order?: number;
  children?: SDKMenu[];
}

export interface Definition {
  name: string;
  version: string;
  displayName?: string;
  icon?: string;
  menus?: SDKMenu[];
  entries?: (SDKMenu & { viewports?: string[] })[];
  navigationComposition?: PluginNavigationComposition;
  userMenu?: UserMenuItemDefinition[];
  scopes?: SDKScopeDeclaration[];
}

type PageComponent = ComponentType<any>;
interface NavigationRegistration {
  plugin: InstalledPlugin;
  definition?: Definition;
  components: Record<string, PageComponent>;
  routes: Record<string, PageComponent>;
  error?: Error;
}

interface CompiledMenu extends SDKMenu {
  treeParent?: string;
}

function RoutePage({ component: Component, routeKey }: { component: PageComponent; routeKey: string }) {
  return <Component key={routeKey} params={useParams()} locationSearch={useLocation().search} />;
}

function MenuLanding({ basePath, menus }: { basePath: string; menus: SDKMenu[] }) {
  const { has } = usePermissions();
  const path = menuLandingPath(menus, has, basePath);
  return path ? <Navigate to={path} replace /> : null;
}

export function menuLandingPath(menus: SDKMenu[], has: (permission: string) => boolean, basePath?: string): string | undefined {
  const compiled = compileMenus(menus);
  const visible = (menu: CompiledMenu): boolean => {
    if (menu.hidden || (menu.authKey && !has(menu.authKey))) return false;
    const parent = compiled.find(candidate => candidate.path === menu.treeParent);
    return !parent || visible(parent);
  };
  const ordered = (parent?: string): CompiledMenu[] => compiled.filter(menu => menu.treeParent === parent)
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999)).flatMap(menu => [menu, ...ordered(menu.path)]);
  return ordered()
    .find(menu => !menu.parent && visible(menu) && !/[:*\[]/.test(menu.path) && (!basePath || pathNamespace(menu.path) === basePath))?.path;
}

function validateMenu(menu: SDKMenu): void {
  if (!menu || typeof menu.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(menu.name)
    || typeof menu.path !== "string" || !menu.path.startsWith("/") || menu.path.startsWith("//")) {
    throw new Error("SDK menu requires a kebab-case name and same-origin absolute path");
  }
  for (const field of ["title", "icon", "authKey", "parent", "group"] as const) {
    if (menu[field] !== undefined && typeof menu[field] !== "string") throw new Error(`Invalid ${field} for menu "${menu.name}"`);
  }
  if (menu.hidden !== undefined && typeof menu.hidden !== "boolean") throw new Error(`Invalid hidden for menu "${menu.name}"`);
  if (menu.requiredScope !== undefined && !Array.isArray(menu.requiredScope)) throw new Error(`Invalid requiredScope for menu "${menu.name}"`);
  if (menu.children !== undefined && !Array.isArray(menu.children)) throw new Error(`Invalid children for menu "${menu.name}"`);
  routePath(menu.path);
  if (menu.scope !== undefined && menu.scope !== "platform" && menu.scope !== "cluster") throw new Error(`Unsupported menu scope "${menu.scope}": Console supports platform and current cluster only`);
  if (menu.requiredScope?.some(scope => scope !== "platform" && scope !== "cluster")) throw new Error(`Unsupported requiredScope for menu "${menu.name}": Console supports platform and current cluster only`);
  if (menu.order !== undefined && !Number.isFinite(menu.order)) throw new Error(`Invalid order for menu "${menu.name}"`);
}

function compileMenus(menus: SDKMenu[], parent?: CompiledMenu, ancestors = new Set<SDKMenu>()): CompiledMenu[] {
  return menus.flatMap(menu => {
    validateMenu(menu);
    if (ancestors.has(menu)) throw new Error(`Cyclic children for menu "${menu.name}"`);
    const compiled: CompiledMenu = { ...menu, path: "/" + routePath(menu.path), children: undefined,
      scope: menu.scope ?? parent?.scope,
      treeParent: parent?.path, parent: menu.parent ?? parent?.parent,
      authKey: menu.authKey ?? parent?.authKey, hidden: menu.hidden || parent?.hidden };
    return [compiled, ...compileMenus(menu.children ?? [], compiled, new Set([...ancestors, menu]))];
  });
}

function menuComponent(menu: SDKMenu, path: string, registration: NavigationRegistration): PageComponent {
  const key = menu.name.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  const component = registration.routes[path] ?? registration.components[key] ?? registration.components[menu.name];
  if (!component) throw new Error(`Menu component "${key}" for "${menu.path}" was not registered`);
  return component;
}

function menuMetadata(menu: CompiledMenu, definition?: Definition): NonNullable<ModulePage["menu"]> {
  return { label: menu.title ?? menu.name, icon: menuIcon(menu.icon || definition?.icon),
    key: menu.name.split("-").map((part, index) => index ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(""),
    scope: menu.scope, parent: menu.parent, treeParent: menu.treeParent, group: menu.group, order: menu.order ?? 999, hidden: menu.hidden };
}

function menuPage(menu: CompiledMenu, primary: string, registration: NavigationRegistration): ModulePage {
  const basePath = pathNamespace(menu.path);
  return {
    path: relativePath(menu.path, basePath), ...(basePath === primary ? {} : { basePath }),
    element: <RoutePage component={menuComponent(menu, menu.path, registration)} routeKey={menu.path} />,
    permission: menu.authKey, requiresWrite: false,
    menu: menuMetadata(menu, registration.definition),
  };
}

function normalizedRoutes(routes: NavigationRegistration["routes"], basePath: string, menuMounts: string[]) {
  const normalized: NavigationRegistration["routes"] = Object.create(null);
  const mounts: Record<string, string> = Object.create(null);
  const declared = new Set<string>();
  for (const [pattern, component] of Object.entries(routes)) {
    const path = absoluteRoute(pattern, basePath);
    const identity = path.replace(/:[\w-]+/g, ":param");
    if (declared.has(identity)) throw new Error(`SDK route "${pattern}" declared twice after normalization`);
    declared.add(identity);
    normalized[path] = component;
    mounts[path] = pattern.startsWith("/")
      ? menuMounts.filter(mount => path === mount || path.startsWith(mount + "/")).sort((left, right) => right.length - left.length)[0] ?? pathNamespace(path)
      : basePath;
  }
  return { routes: normalized, mounts };
}

function addRoutes(pages: ModulePage[], registration: NavigationRegistration, basePath: string, mounts: Record<string, string>): void {
  const module = { basePath };
  for (const [path, component] of Object.entries(registration.routes)) {
    if (pages.some(page => pagePath(module, page) === path)) continue;
    const owner = pages.filter(page => page.menu && matchPath({ path: pagePath(module, page), end: false }, path))
      .sort((left, right) => routeSpecificity(pagePath(module, right)) - routeSpecificity(pagePath(module, left)))[0];
    const mount = mounts[path];
    pages.push({ path: relativePath(path, mount), ...(mount === basePath ? {} : { basePath: mount }),
      element: <RoutePage component={component} routeKey={path} />, permission: owner?.permission });
  }
}

function addLandings(pages: ModulePage[], basePath: string, menus: SDKMenu[], preferredMenus: SDKMenu[]): void {
  const mounts = new Set([basePath, ...pages.map(page => page.basePath ?? basePath)]);
  const preferredMounts = new Set(compileMenus(preferredMenus).map(menu => pathNamespace(menu.path)));
  for (const mount of mounts) {
    if (pages.some(page => (page.basePath ?? basePath) === mount && page.path === "")) continue;
    const candidates = preferredMounts.has(mount) ? preferredMenus : menus;
    pages.unshift({ path: "", ...(mount === basePath ? {} : { basePath: mount }), element: <MenuLanding basePath={mount} menus={candidates} /> });
  }
}

function userMenuTarget(value: unknown, entries: RegisteredEntry[], field: string): UserMenuTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const target = value as Record<string, unknown>;
  if (target.kind === "entry" && typeof target.name === "string" && Object.keys(target).every(key => key === "kind" || key === "name")) {
    const entry = entries.find(menu => menu.name === target.name);
    if (!entry || /[:*]/.test(entry.path)) throw new Error(`${field} must name a registered static entry in this plugin`);
    return { kind: "entry", name: target.name };
  }
  if (target.kind === "application" && typeof target.id === "string"
    && /^(?:console|[a-z][a-z0-9-]*\/(?:platform|cluster))$/.test(target.id)
    && Object.keys(target).every(key => key === "kind" || key === "id")) {
    return { kind: "application", id: target.id };
  }
  throw new Error(`${field} must reference an entry or application`);
}

function compileUserMenu(value: unknown, entries: RegisteredEntry[]): UserMenuItemDefinition[] {
  if (!Array.isArray(value)) throw new Error("SDK userMenu must be an array");
  const ids = new Set<string>();
  return Array.from(value, (item: unknown, index) => {
    const field = `SDK userMenu[${index}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error(`${field} must be an object`);
    const { id, title, order, target, ...extra } = item as Record<string, unknown>;
    if (Object.keys(extra).length) throw new Error(`${field} contains unsupported fields`);
    if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${field}.id must be kebab-case`);
    if (ids.has(id)) throw new Error(`SDK userMenu id "${id}" declared twice`);
    ids.add(id);
    if (typeof title !== "string" || !title.trim()) throw new Error(`${field}.title must be a nonempty string`);
    if (order !== undefined && (typeof order !== "number" || !Number.isSafeInteger(order))) throw new Error(`${field}.order must be a safe integer`);
    return { id, title, ...(order === undefined ? {} : { order }), target: userMenuTarget(target, entries, `${field}.target`) };
  });
}

export function buildModule(registration: NavigationRegistration): ConsoleModule {
  const { plugin, definition, error } = registration;
  if (error) throw error;
  if (!definition) throw new Error("Entry did not register a ModelSphere SDK plugin");
  if (definition.entries !== undefined && !Array.isArray(definition.entries)) throw new Error("SDK entries must be an array");
  if (definition.menus !== undefined && !Array.isArray(definition.menus)) throw new Error("SDK menus must be an array");
  const entryMenus = businessMenus(definition.entries ?? []);
  const legacyMenus = definition.menus ?? [];
  const sourceMenus = [...entryMenus, ...legacyMenus];
  if (!sourceMenus.length) throw new Error("Entry did not register a menu");
  const menus = compileMenus(sourceMenus);
  const entries = compileMenus([...(definition.entries ?? []), ...(definition.menus ?? [])]);
  if (new Set(entries.map(menu => menu.name)).size !== entries.length) throw new Error("SDK menu name declared twice");
  const identities = menus.map(menu => menu.path.replace(/:[\w-]+/g, ":param"));
  if (new Set(identities).size !== menus.length) throw new Error("SDK menu path declared twice");
  const scopes = buildScopeDeclarations(definition, menus);
  const composition = definition.navigationComposition === undefined ? undefined : compileNavigationComposition({
    ...definition.navigationComposition,
    name: plugin.id,
    version: definition.version,
    displayName: definition.displayName ?? plugin.id,
  });
  const primaryMenu = composition ? legacyMenus[0] ?? menus[0] : menus[0];
  const basePath = pathNamespace(primaryMenu.path);
  const normalized = normalizedRoutes(registration.routes, basePath, [...new Set(menus.map(menu => pathNamespace(menu.path)))]);
  const navigation = { ...registration, routes: normalized.routes };
  const pages = menus.map(menu => menuPage(menu, basePath, navigation));
  addRoutes(pages, navigation, basePath, normalized.mounts);
  if (entryMenus.length) addBusinessRoutes(pages, entryMenus, basePath, navigation);
  addLandings(pages, basePath, sourceMenus, composition ? legacyMenus : []);
  const module: ConsoleModule = { id: plugin.id, title: definition.displayName ?? definition.name, basePath,
    capability: plugin.backend?.name, frame: "flush", pages, navigation: {
      provider: `${plugin.group ?? "modelsphere.dev"}/${plugin.id}`, scopes,
      entries: entries.map(menu => ({ name: menu.name, path: menu.path, menu: menuMetadata(menu, definition) })),
      menus: compileMenus(legacyMenus).map(menu => menu.name),
      ...(composition ? { composition } : {}),
    } };
  if (definition.userMenu !== undefined) module.userMenu = compileUserMenu(definition.userMenu, entryRegistry([module]));
  return module;
}

function businessMenus(entries: SDKMenu[]): SDKMenu[] {
  const paths = new Map<string, SDKMenu>();
  const names = new Set<string>();
  for (const entry of entries) {
    validateMenu(entry);
    if (names.has(entry.name)) throw new Error(`SDK business entry "${entry.name}" declared twice`);
    names.add(entry.name);
    const previous = paths.get(entry.path);
    if (previous && (previous.authKey !== entry.authKey || previous.scope !== entry.scope)) throw new Error(`Conflicting business entries for "${entry.path}"`);
    if (!previous) paths.set(entry.path, entry);
  }
  return [...paths.values()];
}

function addBusinessRoutes(pages: ModulePage[], menus: SDKMenu[], basePath: string, registration: NavigationRegistration): void {
  for (const menu of menus) {
    if (/[:*\[]/.test(menu.path)) continue;
    const path = menu.path + "/*";
    if (pages.some(page => pagePath({ basePath }, page) === path)) continue;
    const mount = pathNamespace(menu.path);
    pages.push({ path: relativePath(path, mount), ...(mount === basePath ? {} : { basePath: mount }),
      element: <RoutePage component={menuComponent(menu, menu.path, registration)} routeKey={path} />, permission: menu.authKey });
  }
}
