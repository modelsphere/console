import type { NavigationScope } from "@/shell/navigation-types";
import { menuIcon } from "./icons";
import { routePath } from "./navigation-paths";
import type { Definition, SDKMenu } from "./navigation";

export interface SDKScopeDeclaration {
  scope: string;
  viewport?: string;
  title?: string;
  icon?: string;
  category?: string;
  path?: string;
}

export function buildScopeDeclarations(definition: Definition, menus?: SDKMenu[]): NavigationScope[] {
  if (definition.scopes !== undefined && !Array.isArray(definition.scopes)) throw new Error("SDK scopes must be an array");
  const declarations: SDKScopeDeclaration[] = definition.scopes ?? [];
  const declared = new Set<string>();
  const scopes = declarations.map(declaration => {
    if (!declaration || (declaration.scope !== "platform" && declaration.scope !== "cluster")) throw new Error("Unsupported scopes: Console supports platform and current cluster only");
    if (declared.has(declaration.scope)) throw new Error(`Duplicate navigation scope "${declaration.scope}"`);
    declared.add(declaration.scope);
    for (const field of ["title", "icon", "category", "viewport", "path"] as const) {
      if (declaration[field] !== undefined && typeof declaration[field] !== "string") throw new Error(`Invalid scope ${field}`);
    }
    const path = declaration.path === undefined ? undefined : "/" + routePath(declaration.path);
    if (path !== undefined && (!declaration.path!.startsWith("/") || /[:*]/.test(path) || (menus && !menus.some(menu => menu.path === path && (menu.scope ?? "platform") === declaration.scope)))) {
      throw new Error(`Application path "${declaration.path}" must name a registered static menu`);
    }
    return {
      scope: declaration.scope as "platform" | "cluster", title: declaration.title || definition.displayName || definition.name,
      icon: menuIcon(declaration.icon || definition.icon), path,
    };
  });
  return scopes;
}
