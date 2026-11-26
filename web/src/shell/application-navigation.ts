import { Boxes, LayoutDashboard } from "lucide-react";
import { activeApplication, type ApplicationItem } from "./applications";
import { flattenNavItems, pagePath, type ConsoleModule, type NavGroup } from "./module";
import { consoleNavigation } from "./console-navigation";
import { entryRegistry, moduleNavigation, routeEntry, type RegisteredEntry } from "./navigation-registry";
import { compositionPlacements, defaultPlacements, navigationGroups, type Placement } from "./navigation-compose";
import type { HostNavigation } from "./navigation-types";

function uniquePlacements(placements: Placement[]): Placement[] {
  const seen = new Set<string>();
  return placements.filter(placement => {
    const route = `${placement.entry.module.id}:${placement.entry.path}`;
    if (seen.has(route)) return false;
    seen.add(route);
    return true;
  });
}

function applicationPaths(modules: ConsoleModule[], entries: RegisteredEntry[], placements: Placement[], id: string): string[] {
  const owners = new Map(placements.map(placement => [`${placement.entry.module.id}:${placement.entry.path}`, placement.application]));
  return modules.flatMap(module => module.pages.filter(page => {
    const entry = routeEntry(module, page, entries);
    return (entry ? owners.get(`${entry.module.id}:${entry.path}`) ?? "console" : "console") === id;
  }).map(page => pagePath(module, page)));
}

function declaredApplications(modules: ConsoleModule[]) {
  return modules.flatMap(module => {
    const { composition, scopes } = moduleNavigation(module);
    return composition ? (composition.scopes ?? scopes).map(scope => ({
      id: `${module.id}/${scope.scope}`, ns: module.id, scope: scope.scope, label: scope.title, icon: scope.icon,
      path: scope.path, groups: composition.groups, launcher: composition.launcher,
    })) : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function applicationNavigation(modules: ConsoleModule[], has: (permission: string) => boolean, pathname: string, host: HostNavigation = consoleNavigation) {
  const entries = entryRegistry(modules);
  const declared = declaredApplications(modules);
  const placements = uniquePlacements([
    ...compositionPlacements(host.groups, entries, "console"),
    ...declared.flatMap(application => compositionPlacements(application.groups, entries, application.id, application.ns, application.scope)),
    ...defaultPlacements(modules, entries, host),
  ]);
  const installed = declared.flatMap(application => {
    const groups = navigationGroups(placements.filter(placement => placement.application === application.id), entries, has);
    const targets = flattenNavItems(groups.flatMap(group => group.items)).filter(item => !/[:*]/.test(item.to));
    const target = targets.find(item => item.to === application.path) ?? targets[0];
    return target ? [{ ...application, to: target.to, paths: applicationPaths(modules, entries, placements, application.id) }] : [];
  });
  const applications: ApplicationItem[] = installed.length ? [{
    id: "console", ns: "shell", scope: "console", label: "Console", icon: Boxes, to: "/", paths: ["/", ...applicationPaths(modules, entries, placements, "console")],
  }, ...installed] : [];
  const activeID = activeApplication(applications, pathname) ?? "console";
  const groups = navigationGroups(placements.filter(placement => placement.application === activeID), entries, has);
  if (activeID === "console") groups.unshift(overviewGroup());
  return { applications, activeID, groups };
}

function overviewGroup(): NavGroup {
  return { items: [{ to: "/", label: "概览", ns: "shell", key: "overview", icon: LayoutDashboard, end: true }] };
}
