import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
export { activeGroupTitle, activeNavItem, flattenNavItems, navGroups, routeSpecificity, topbarItems } from "./module-navigation";

// A module is one feature area of the console (iam, swiss, …). It declares its
// pages; the shell owns everything around them: login, layout, sidebar, route
// guards, the query client and the session on every request.
//
// Built-ins register in src/modules/index.ts; configured plugins register through the ModelSphere SDK host.
export interface ModuleOverviewProps {
  session?: ReactNode;
}

export interface ConsoleModule {
  // Stable id: used as the React key and in logs. Lowercase, no spaces.
  id: string;
  // Sidebar group heading, in Chinese. Other languages: "{id}:group.{title}"
  // in the module's strings (see navLabel in shell/i18n.ts).
  title: string;
  // Every page mounts below this path, e.g. "/swiss". No trailing slash.
  basePath: string;
  pages: ModulePage[];
  capability?: string;
  // "flush": pages draw Rise Global's skeleton themselves -- a PageBanner edge to
  // edge, then their own p-4 body. Default "padded": the shell insets the page.
  frame?: "padded" | "flush";
  // Optional card(s) shown on the console home page.
  overview?: ComponentType<ModuleOverviewProps>;
}

export interface ModulePage {
  // Relative to basePath. "" is the module's index; ":params" are allowed.
  path: string;
  // Additional plugin namespace; omitted for pages under the module's primary mount.
  basePath?: string;
  element: ReactNode;
  // UI permission (a Role's uiPermissions entry). Guards the route and hides the
  // menu entry. Omit for pages every logged-in user may see.
  permission?: string;
  requiresWrite?: boolean;
  // Hidden entries retain route/ownership metadata without appearing in navigation.
  menu?: { label: string; icon: LucideIcon; key?: string; parent?: string; treeParent?: string; group?: string; order?: number; hidden?: boolean };
  // Also link the page from the top bar; an object overrides its menu label.
  topbar?: boolean | { label: string };
}

const ModuleContext = createContext<ConsoleModule | null>(null);

export function ModuleProvider({ module, basePath, children }: { module: ConsoleModule; basePath?: string; children: ReactNode }) {
  return <ModuleContext.Provider value={basePath ? { ...module, basePath } : module}>{children}</ModuleContext.Provider>;
}

// joinPath("/swiss", "catalog/x") === "/swiss/catalog/x"; joinPath("/swiss", "") === "/swiss".
export function joinPath(basePath: string, path: string): string {
  const rel = path.replace(/^\/+/, "");
  return rel ? `${basePath}/${rel}` : basePath || "/";
}

export function pagePath(module: Pick<ConsoleModule, "basePath">, page: ModulePage): string {
  return joinPath(page.basePath ?? module.basePath, page.path);
}

export function moduleMounts(module: ConsoleModule): string[] {
  return [...new Set([module.basePath, ...module.pages.map(page => page.basePath ?? module.basePath)])];
}

// useModulePath turns a module-relative path into an absolute one, so a module's
// links survive being mounted anywhere: `<Link to={p("catalog")}>`.
export function useModulePath(): (path: string) => string {
  const module = useContext(ModuleContext);
  if (!module) throw new Error("useModulePath outside a module page");
  return (path) => joinPath(module.basePath, path);
}

const RESERVED = new Set(["/login", "/change-password", "/api", "/oauth", "/plugins", "/assets"]);
// A module's id is its i18n namespace; these belong to the shell.
const RESERVED_IDS = new Set(["common", "shell", "ui"]);

// validateModules fails fast on declarations that would otherwise collide
// silently at runtime (two modules on one path, a page mounted twice).
export function validateModules(modules: ConsoleModule[]): void {
  const ids = new Set<string>();
  const bases = new Set<string>();
  for (const m of modules) {
    if (!/^[a-z][a-z0-9-]*$/.test(m.id)) throw new Error(`module id "${m.id}" must be lowercase kebab-case`);
    if (RESERVED_IDS.has(m.id)) throw new Error(`module id "${m.id}" is reserved by the shell`);
    if (ids.has(m.id)) throw new Error(`duplicate module id "${m.id}"`);
    ids.add(m.id);
    const mounts = moduleMounts(m);
    for (const mount of mounts) {
      if (!/^\/[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*$/.test(mount) || mount.split("/").some(segment => segment === "." || segment === "..")) throw new Error(`module "${m.id}": invalid basePath "${mount}"`);
      if (RESERVED.has("/" + mount.split("/")[1])) throw new Error(`module "${m.id}": basePath "${mount}" is reserved by the shell`);
      if ([...bases].some(base => base === mount || base.startsWith(mount + "/") || mount.startsWith(base + "/"))) {
        throw new Error(`module "${m.id}": basePath "${mount}" already taken or overlaps another module`);
      }
    }
    mounts.forEach(mount => bases.add(mount));
    const paths = new Set<string>();
    for (const p of m.pages) {
      const pattern = pagePath(m, p).replace(/:[\w-]+/g, ":param");
      if (paths.has(pattern)) throw new Error(`module "${m.id}": page path "${p.path}" declared twice`);
      paths.add(pattern);
    }
  }
}

// label/title are the declared Chinese literals; ns and key are where other
// languages look them up. The Layout translates at render time.
export interface NavItem {
  to: string;
  label: string;
  ns: string;
  key: string;
  icon: LucideIcon;
  end: boolean;
  group?: string;
  order?: number;
  children?: NavItem[];
}

export interface NavGroup {
  title?: string;
  ns?: string;
  // The module's mount point: every page below it belongs to this group, menu
  // entry or not (a detail page has none).
  basePath?: string;
  items: NavItem[];
  paths?: string[];
}
