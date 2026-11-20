import type { ComponentType } from "react";
import { Navigate, matchPath, useLocation, useParams } from "react-router";
import { usePermissions } from "@/shell/permissions";
import { pagePath, routeSpecificity, type ConsoleModule, type ModulePage } from "@/shell/module";
import { menuIcon } from "./icons";
import { absoluteRoute, pathNamespace, relativePath, routePath } from "./navigation-paths";
import type { InstalledPlugin } from "./runtime";

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
  scopes?: { scope: string; viewport?: string; path?: string }[];
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

function RoutePage({ component: Component }: { component: PageComponent }) {
  return <Component params={useParams()} locationSearch={useLocation().search} />;
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
  if (menu.scope !== undefined && menu.scope !== "platform") throw new Error(`Unsupported menu scope "${menu.scope}": Console supports platform only`);
  if (menu.requiredScope?.some(scope => scope !== "platform")) throw new Error(`Unsupported requiredScope for menu "${menu.name}": Console supports platform only`);
  if (menu.order !== undefined && !Number.isFinite(menu.order)) throw new Error(`Invalid order for menu "${menu.name}"`);
}

function compileMenus(menus: SDKMenu[], parent?: CompiledMenu, ancestors = new Set<SDKMenu>()): CompiledMenu[] {
  return menus.flatMap(menu => {
    validateMenu(menu);
    if (ancestors.has(menu)) throw new Error(`Cyclic children for menu "${menu.name}"`);
    const compiled: CompiledMenu = { ...menu, path: "/" + routePath(menu.path), children: undefined,
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

function menuPage(menu: CompiledMenu, primary: string, registration: NavigationRegistration): ModulePage {
  const basePath = pathNamespace(menu.path);
  return {
    path: relativePath(menu.path, basePath), ...(basePath === primary ? {} : { basePath }),
    element: <RoutePage component={menuComponent(menu, menu.path, registration)} />,
    permission: menu.authKey, requiresWrite: false,
    menu: { label: menu.title ?? menu.name, icon: menuIcon(menu.icon || registration.definition?.icon),
      key: menu.name.split("-").map((part, index) => index ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(""),
      parent: menu.parent, treeParent: menu.treeParent, group: menu.group, order: menu.order ?? 999, hidden: menu.hidden },
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
      element: <RoutePage component={component} />, permission: owner?.permission });
  }
}

function addLandings(pages: ModulePage[], basePath: string, menus: SDKMenu[]): void {
  const mounts = new Set([basePath, ...pages.map(page => page.basePath ?? basePath)]);
  for (const mount of mounts) {
    if (pages.some(page => (page.basePath ?? basePath) === mount && page.path === "")) continue;
    pages.unshift({ path: "", ...(mount === basePath ? {} : { basePath: mount }), element: <MenuLanding basePath={mount} menus={menus} /> });
  }
}

export function buildModule(registration: NavigationRegistration): ConsoleModule {
  const { plugin, definition, error } = registration;
  if (error) throw error;
  if (!definition) throw new Error("Entry did not register a ModelSphere SDK plugin");
  if (!definition.menus?.length) throw new Error("Entry did not register a menu");
  if (!Array.isArray(definition.menus)) throw new Error("SDK menus must be an array");
  const menus = compileMenus(definition.menus);
  if (new Set(menus.map(menu => menu.name)).size !== menus.length) throw new Error("SDK menu name declared twice");
  const identities = menus.map(menu => menu.path.replace(/:[\w-]+/g, ":param"));
  if (new Set(identities).size !== menus.length) throw new Error("SDK menu path declared twice");
  if (definition.scopes !== undefined && !Array.isArray(definition.scopes)) throw new Error("SDK scopes must be an array");
  if (definition.scopes?.some(scope => !scope || scope.scope !== "platform")) throw new Error("Unsupported scopes: Console supports platform only");
  const basePath = pathNamespace(menus[0].path);
  const normalized = normalizedRoutes(registration.routes, basePath, [...new Set(menus.map(menu => pathNamespace(menu.path)))]);
  const navigation = { ...registration, routes: normalized.routes };
  const pages = menus.map(menu => menuPage(menu, basePath, navigation));
  addRoutes(pages, navigation, basePath, normalized.mounts);
  addLandings(pages, basePath, definition.menus);
  return { id: plugin.id, title: definition.displayName ?? definition.name, basePath,
    capability: plugin.backend?.name, frame: "flush", pages };
}
