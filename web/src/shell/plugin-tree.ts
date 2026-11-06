import type { ConsoleModule } from "./module";
import type { InstalledPlugin } from "./global-sdk/runtime";

export interface NavigationFolder { id: string; title: string }
export interface BuiltinPlugin { id: string; source: "builtin" }
export interface PluginFolder { folder: string; title: string; children: FrontendNode[] }
export type FrontendNode = BuiltinPlugin | InstalledPlugin | PluginFolder;

export function explicitFrontendTree(nodes: FrontendNode[]): boolean {
  return nodes.some((node) => "folder" in node || !!node.source);
}

export function* frontendLeaves(nodes: FrontendNode[], folders: NavigationFolder[] = []): Generator<{ plugin: BuiltinPlugin | InstalledPlugin; folders: NavigationFolder[] }> {
  for (const node of nodes) {
    if ("folder" in node) yield* frontendLeaves(node.children, [...folders, { id: node.folder, title: node.title }]);
    else yield { plugin: node, folders };
  }
}

export function configuredBuiltin(plugin: BuiltinPlugin, builtins: ConsoleModule[], folders: NavigationFolder[]): ConsoleModule {
  const module = builtins.find((candidate) => candidate.id === plugin.id);
  if (!module) throw new Error(`Unknown built-in module "${plugin.id}"`);
  return { ...module, navigationFolders: folders };
}

// Built-in mount paths come from the compiled registry; reject collisions before any remote executes.
export function validateFrontendPaths(nodes: FrontendNode[], builtins: ConsoleModule[], initial: ConsoleModule[]): void {
  const paths = new Set(initial.map((module) => module.basePath));
  for (const { plugin } of frontendLeaves(nodes)) {
    const path = plugin.source === "builtin" ? builtins.find((module) => module.id === plugin.id)?.basePath : plugin.menu.path;
    if (!path) continue;
    if (paths.has(path)) throw new Error(`Frontend path "${path}" already taken`);
    paths.add(path);
  }
}
