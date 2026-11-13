import { useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronRight, Folder } from "lucide-react";
import type { NavGroup, NavItem } from "./module";
import { navLabel, useT } from "./i18n";

const ITEM_BASE = "flex items-center gap-3 rounded-lg px-3 text-sm transition-colors";
const itemSize = (board: boolean) => board ? "py-2.5 font-medium" : "py-2";
const ITEM_IDLE = "text-foreground/80 hover:bg-accent hover:text-foreground";
const ITEM_ACTIVE = "bg-primary/10 text-primary";

export function groupContainsPath(group: NavGroup, pathname: string): boolean {
  return !!group.basePath && (pathname === group.basePath || pathname.startsWith(group.basePath + "/"))
    || !!group.children?.some((child) => groupContainsPath(child, pathname));
}

export function navigationItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((group) => [...group.items, ...navigationItems(group.children ?? [])]);
}

export function Sidebar({ groups, collapsed, board = false }: { groups: NavGroup[]; collapsed: boolean; board?: boolean }) {
  if (collapsed) return <div className="space-y-1">{navigationItems(groups).map((item) => <MenuLink key={item.to} item={item} iconOnly />)}</div>;
  return <SidebarLevel groups={groups} board={board} />;
}

function SidebarLevel({ groups, board }: { groups: NavGroup[]; board: boolean }) {
  const { pathname } = useLocation();
  const activeKey = groups.find((group) => groupContainsPath(group, pathname))?.id;
  const [open, setOpen] = useState(activeKey ?? groups.find((group) => group.title)?.id);
  // Opening an ancestor on navigation also reveals detail pages without menu entries.
  useEffect(() => { if (activeKey) setOpen(activeKey); }, [activeKey, pathname]);
  return <div className="space-y-1">{groups.map((group, index) => group.title ? (
    <SidebarBranch key={group.id ?? index} group={group} board={board} expanded={open === group.id} active={activeKey === group.id} onToggle={() => setOpen(open === group.id ? "" : group.id)} />
  ) : <div key={index} className="mb-1 space-y-0.5">{group.items.map((item) => <MenuLink key={item.to} item={item} board={board} />)}</div>)}</div>;
}

function SidebarBranch({ group, board, expanded, active, onToggle }: { group: NavGroup; board: boolean; expanded: boolean; active: boolean; onToggle: () => void }) {
  const t = useT("shell");
  const contentId = useId();
  return <div className="mb-1">
    <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-lg px-3 text-sm transition-colors hover:bg-accent ${itemSize(board)} ${active ? "text-primary" : "text-foreground/80"}`}>
      <span className="flex items-center gap-2">{group.children && <Folder aria-hidden className="size-4 shrink-0" />}{navLabel(t, group.ns, "group", group.title!, group.title!)}</span>
      <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
    </button>
    <div id={contentId} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!expanded}>
      <div className="overflow-hidden"><div className="pl-4">
        {group.items.map((item) => <MenuLink key={item.to} item={item} board={board} />)}
        {group.children && <SidebarLevel groups={group.children} board={board} />}
      </div></div>
    </div>
  </div>;
}

function MenuLink({ item, iconOnly = false, board = false }: { item: NavItem; iconOnly?: boolean; board?: boolean }) {
  const t = useT("shell");
  const { to, icon: Icon, end } = item;
  const label = navLabel(t, item.ns, "menu", item.key, item.label);
  return <NavLink to={to} end={end} title={iconOnly ? label : undefined} className={({ isActive }) => iconOnly
    ? `flex h-10 items-center justify-center rounded-lg transition-colors ${isActive ? ITEM_ACTIVE : ITEM_IDLE}`
    : `${ITEM_BASE} ${itemSize(board)} ${isActive ? `${ITEM_ACTIVE} font-medium` : ITEM_IDLE}`}>
    {({ isActive }) => <><Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />{!iconOnly && <span className="truncate">{label}</span>}</>}
  </NavLink>;
}
