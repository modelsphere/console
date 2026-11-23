import type { ConsoleModule, NavGroup, NavItem } from "./module";
import { entryItem, entryVisible, type RegisteredEntry } from "./navigation-registry";
import type { CompositionGroup, HostNavigation } from "./navigation-types";

export interface Placement {
  entry: RegisteredEntry;
  application: string;
  group: string;
  title: string;
  ns?: string;
  explicit: boolean;
}

export function compositionPlacements(groups: CompositionGroup[], entries: RegisteredEntry[], application: string, ns?: string, scope?: string): Placement[] {
  return groups.flatMap(group => group.menus.flatMap(reference => {
    if (scope && reference.scope && reference.scope !== scope) return [];
    const entry = entries.find(candidate => candidate.provider === reference.provider && candidate.name === reference.entry);
    const context = reference.scope ?? scope;
    return entry && (!context || (entry.menu.scope ?? "platform") === context)
      ? [{ entry, application, group: group.name, title: group.title, ns: ns ?? group.ns, explicit: true }] : [];
  }));
}

export function defaultPlacements(modules: ConsoleModule[], entries: RegisteredEntry[], host: HostNavigation): Placement[] {
  const groups = new Map(modules.map(module => [module.id, module]));
  return entries.filter(entry => entry.legacy).flatMap(entry => {
    const owner = groups.get(entry.menu.parent ?? entry.module.id);
    const group = host.groups.find(candidate => candidate.name === owner?.id);
    return owner ? [{ entry, application: "console", group: owner.id, title: group?.title ?? owner.title, ns: owner.id, explicit: false }] : [];
  });
}

function orderedItems(items: NavItem[], explicit: Map<string, number>): NavItem[] {
  const groups = new Map<string, NavItem[]>();
  const order = (left: NavItem, right: NavItem) => {
    const leftIndex = explicit.get(left.to);
    const rightIndex = explicit.get(right.to);
    if (leftIndex !== undefined || rightIndex !== undefined) return (leftIndex ?? Infinity) - (rightIndex ?? Infinity);
    return (left.order ?? 999) - (right.order ?? 999);
  };
  for (const item of [...items].sort(order)) {
    const group = item.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ ...item, ...(item.children ? { children: orderedItems(item.children, explicit) } : {}) });
  }
  return [...groups.values()].flat();
}

function groupItems(placements: Placement[]): NavItem[] {
  const items = new Map(placements.map(placement => [placement.entry.id, entryItem(placement.entry)]));
  const roots: NavItem[] = [];
  for (const placement of placements) {
    const item = items.get(placement.entry.id)!;
    if (placement.explicit) item.group = undefined;
    const parent = placements.find(candidate => candidate.entry.module.id === placement.entry.module.id && candidate.entry.path === placement.entry.menu.treeParent);
    if (parent) (items.get(parent.entry.id)!.children ??= []).push(item);
    else roots.push(item);
  }
  const explicit = new Map(placements.flatMap((placement, index) => placement.explicit ? [[placement.entry.path, index] as const] : []));
  return orderedItems(roots, explicit);
}

export function navigationGroups(placements: Placement[], entries: RegisteredEntry[], has: (permission: string) => boolean): NavGroup[] {
  const groups = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (!groups.has(placement.group)) groups.set(placement.group, []);
    groups.get(placement.group)!.push(placement);
  }
  return [...groups.values()].map(group => ({
    id: `${group[0].application}/${group[0].group}`, title: group[0].title || undefined, ns: group[0].ns,
    items: groupItems(group.filter(placement => entryVisible(placement.entry, entries, has))),
    paths: group.flatMap(placement => [placement.entry.path, `${placement.entry.path}/*`]),
  })).filter(group => group.items.length);
}
