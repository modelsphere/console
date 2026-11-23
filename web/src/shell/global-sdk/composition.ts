import { type ConsoleModule } from "@/shell/module";
import { buildScopeDeclarations, type SDKScopeDeclaration } from "./scope-declarations";

export interface NavigationComposition {
  name: string;
  version: string;
  displayName: string;
  scopes: SDKScopeDeclaration[];
  groups: { name: string; title: string; menus: { provider: string; entry: string; scope?: string; viewport?: string }[] }[];
}

export function compositionModule(composition: NavigationComposition, provider = `modelsphere.dev/${composition.name}`): ConsoleModule {
  if (!composition.version || typeof composition.displayName !== "string" || !Array.isArray(composition.scopes) || !composition.scopes.length || !Array.isArray(composition.groups)) {
    throw new Error("Navigation composition requires version, displayName, scopes and groups");
  }
  const scopes = buildScopeDeclarations({ name: composition.name, version: composition.version, scopes: composition.scopes });
  const groups = new Set<string>();
  for (const group of composition.groups) {
    if (!group || typeof group.name !== "string" || groups.has(group.name) || typeof group.title !== "string" || !Array.isArray(group.menus)) throw new Error("Invalid navigation composition group");
    groups.add(group.name);
    for (const reference of group.menus) {
      if (!reference || !/^[a-z0-9.-]+\/[a-z][a-z0-9-]*$/.test(reference.provider) || typeof reference.entry !== "string" || !reference.entry
        || Object.keys(reference).some(key => !["provider", "entry", "scope", "viewport"].includes(key))
        || (reference.scope !== undefined && !composition.scopes.some(scope => scope.scope === reference.scope))) {
        throw new Error("Invalid navigation composition reference");
      }
    }
  }
  return { id: composition.name, title: composition.displayName, basePath: `/plugin-menus/${composition.name}`, pages: [], navigation: { provider, entries: [], menus: [], scopes, composition: { groups: composition.groups } } };
}
