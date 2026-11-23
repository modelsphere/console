import type { Definition, SDKMenu } from "./navigation";
import { matchPath } from "react-router";
import { routePath } from "./navigation-paths";
import { routeSpecificity } from "@/shell/module";

export interface SDKScope {
  scope: "platform" | "cluster";
  value: string;
  full: string;
}

export function scopeForPath(path: string, definitions: Definition[]): SDKScope {
  const flatten = (menus: SDKMenu[], inheritedScope?: string): SDKMenu[] => menus.flatMap(menu => {
    const scoped = { ...menu, scope: menu.scope ?? inheritedScope };
    return [scoped, ...flatten(menu.children ?? [], scoped.scope)];
  });
  const owner = definitions.flatMap(definition => flatten([...(definition.entries ?? []), ...(definition.menus ?? [])]))
    .filter(menu => matchPath({ path: "/" + routePath(menu.path), end: false }, path))
    .sort((left, right) => routeSpecificity(routePath(right.path)) - routeSpecificity(routePath(left.path)))[0];
  // "current" is a Console-local context, not an identity in Global's cluster directory.
  return owner?.scope === "cluster"
    ? { scope: "cluster", value: "current", full: "cluster/current" }
    : { scope: "platform", value: "global", full: "platform/global" };
}
