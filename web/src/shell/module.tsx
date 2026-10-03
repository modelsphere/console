import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { LayoutDashboard, type LucideIcon } from "lucide-react";
import { pageKey } from "@/shell/i18n";

// A module is one feature area of the console (iam, swiss, …). It declares its
// pages; the shell owns everything around them: login, layout, sidebar, route
// guards, the query client and the session on every request.
//
// Plugging a module in or out is one line in src/modules/index.ts.
export interface ConsoleModule {
  // Stable id: used as the React key and in logs. Lowercase, no spaces.
  id: string;
  // Sidebar group heading, in Chinese. Other languages: "{id}:group.{title}"
  // in the module's strings (see navLabel in shell/i18n.ts).
  title: string;
  // Every page mounts below this path, e.g. "/swiss". No trailing slash.
  basePath: string;
  pages: ModulePage[];
  // "flush": pages draw Rise Global's skeleton themselves -- a PageBanner edge to
  // edge, then their own p-4 body. Default "padded": the shell insets the page.
  frame?: "padded" | "flush";
  // Optional card(s) shown on the console home page.
  overview?: ComponentType;
}

export interface ModulePage {
  // Relative to basePath. "" is the module's index; ":params" are allowed.
  path: string;
  element: ReactNode;
  // UI permission (a Role's uiPermissions entry). Guards the route and hides the
  // menu entry. Omit for pages every logged-in user may see.
  permission?: string;
  // Present means the page gets a sidebar entry. label is Chinese; other
  // languages: "{module id}:menu.{pageKey(path)}".
  menu?: { label: string; icon: LucideIcon };
}

const ModuleContext = createContext<ConsoleModule | null>(null);

export function ModuleProvider({ module, children }: { module: ConsoleModule; children: ReactNode }) {
  return <ModuleContext.Provider value={module}>{children}</ModuleContext.Provider>;
}

// joinPath("/swiss", "catalog/x") === "/swiss/catalog/x"; joinPath("/swiss", "") === "/swiss".
export function joinPath(basePath: string, path: string): string {
  const rel = path.replace(/^\/+/, "");
  return rel ? `${basePath}/${rel}` : basePath || "/";
}

// useModulePath turns a module-relative path into an absolute one, so a module's
// links survive being mounted anywhere: `<Link to={p("catalog")}>`.
export function useModulePath(): (path: string) => string {
  const module = useContext(ModuleContext);
  if (!module) throw new Error("useModulePath outside a module page");
  return (path) => joinPath(module.basePath, path);
}

const RESERVED = new Set(["/login", "/change-password", "/api", "/oauth"]);
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
    if (!/^\/[a-z0-9-]+$/.test(m.basePath)) throw new Error(`module "${m.id}": basePath "${m.basePath}" must look like "/name"`);
    if (RESERVED.has(m.basePath)) throw new Error(`module "${m.id}": basePath "${m.basePath}" is reserved by the shell`);
    if (bases.has(m.basePath)) throw new Error(`module "${m.id}": basePath "${m.basePath}" already taken`);
    bases.add(m.basePath);
    const paths = new Set<string>();
    for (const p of m.pages) {
      if (paths.has(p.path)) throw new Error(`module "${m.id}": page path "${p.path}" declared twice`);
      paths.add(p.path);
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
}

export interface NavGroup {
  title?: string;
  ns?: string;
  // The module's mount point: every page below it belongs to this group, menu
  // entry or not (a detail page has none).
  basePath?: string;
  items: NavItem[];
}

// navGroups turns module declarations into sidebar groups, dropping pages the
// user may not open and groups left empty by that.
export function navGroups(modules: ConsoleModule[], has: (permission: string) => boolean): NavGroup[] {
  const groups: NavGroup[] = [{ items: [{ to: "/", label: "概览", ns: "shell", key: "overview", icon: LayoutDashboard, end: true }] }];
  for (const m of modules) {
    const items = m.pages
      .filter((p) => p.menu && (!p.permission || has(p.permission)))
      .map((p) => ({
        to: joinPath(m.basePath, p.path),
        label: p.menu!.label,
        ns: m.id,
        key: pageKey(p.path),
        icon: p.menu!.icon,
        end: p.path === "",
      }));
    if (items.length) groups.push({ title: m.title, ns: m.id, basePath: m.basePath, items });
  }
  return groups;
}

// activeGroupTitle is the group holding the current page: the module it is
// mounted under. Matching menu entries alone misses a module's pages that have
// none -- /inferences/x/details is under /inferences, whose index entry only
// matches exactly.
export function activeGroupTitle(groups: NavGroup[], pathname: string): string | undefined {
  return groups.find((g) => g.title && g.basePath && (pathname === g.basePath || pathname.startsWith(g.basePath + "/")))?.title;
}
