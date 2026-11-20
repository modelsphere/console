import { Fragment, useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronRight } from "lucide-react";
import { activeGroupTitle, activeNavItem, flattenNavItems, type NavGroup, type NavItem } from "./module";
import { navLabel, useT } from "./i18n";

// Global's menu item. On the minimal board it is 14px/500 with 10px vertical
// padding (BOARD_MENU_ITEM); elsewhere regular weight with 8px.
const ITEM_BASE = "flex items-center gap-3 rounded-lg px-3 text-sm transition-colors";
const itemSize = (board: boolean) => (board ? "py-2.5 font-medium" : "py-2");
const ITEM_IDLE = "text-foreground/80 hover:bg-accent hover:text-foreground";
const ITEM_ACTIVE = "bg-primary/10 text-primary";

// Accordion like Global's sidebar: one group open at a time, starting with the
// group that holds the current page.
export function Sidebar({ groups, collapsed, board = false }: { groups: NavGroup[]; collapsed: boolean; board?: boolean }) {
  const { pathname } = useLocation();
  const activeGroup = activeGroupTitle(groups, pathname);
  const activeItem = activeNavItem(groups.flatMap(group => group.items), pathname);
  const [open, setOpen] = useState<string | undefined>(activeGroup ?? groups.find((g) => g.title)?.title);
  const shown = open ?? activeGroup;
  // Navigating into another module (a link, the back button) opens its group.
  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {flattenNavItems(groups.flatMap((g) => g.items)).map((item) => (
          <MenuLink key={item.to} item={item} active={item === activeItem} iconOnly />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((group, index) =>
        !group.title ? (
          <div key={index} className="mb-1 space-y-0.5">
            <SidebarItems items={group.items} activeItem={activeItem} board={board} />
          </div>
        ) : (
          <SidebarGroup key={group.ns ?? group.title} group={group} board={board} active={group.title === activeGroup}
            expanded={shown === group.title} activeItem={activeItem} onToggle={() => setOpen(shown === group.title ? "" : group.title)} />
        ),
      )}
    </div>
  );
}

function SidebarGroup({ group, board, active, expanded, activeItem, onToggle }: { group: NavGroup; board: boolean; active: boolean; expanded: boolean; activeItem?: NavItem; onToggle: () => void }) {
  const t = useT("shell");
  return (
    <div className="mb-1">
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className={`flex w-full items-center justify-between rounded-lg px-3 text-sm transition-colors hover:bg-accent ${itemSize(board)} ${active ? "text-primary" : "text-foreground/80"}`}>
        <span>{navLabel(t, group.ns, "group", group.title!, group.title!)}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
      </button>
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!expanded}>
        <div className="overflow-hidden">
          <div className="pl-4"><SidebarItems items={group.items} activeItem={activeItem} board={board} /></div>
        </div>
      </div>
    </div>
  );
}

function SidebarItems({ items, activeItem, board }: { items: NavItem[]; activeItem?: NavItem; board: boolean }) {
  const t = useT("shell");
  return items.map((item, index) => (
    <Fragment key={item.to}>
      {item.group && item.group !== items[index - 1]?.group && (
        <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
          {navLabel(t, item.ns, "group", item.group, item.group)}
        </div>
      )}
      <MenuBranch item={item} activeItem={activeItem} board={board} />
    </Fragment>
  ));
}

function MenuBranch({ item, activeItem, board }: { item: NavItem; activeItem?: NavItem; board: boolean }) {
  const t = useT("shell");
  const id = useId();
  const descendantActive = flattenNavItems(item.children ?? []).some(child => child === activeItem);
  const [open, setOpen] = useState(descendantActive);
  useEffect(() => { if (descendantActive) setOpen(true); }, [descendantActive, activeItem?.to]);
  if (!item.children?.length) return <MenuLink item={item} active={item === activeItem} board={board} />;
  const label = navLabel(t, item.ns, "menu", item.key, item.label);
  return (
    <div>
      <div className="flex items-center gap-1 [&>a]:min-w-0 [&>a]:flex-1">
        <MenuLink item={item} active={item === activeItem} board={board} />
        <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
          <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      <div id={id} hidden={!open} className="ml-4 space-y-0.5 border-l border-border pl-2">
        <SidebarItems items={item.children} activeItem={activeItem} board={board} />
      </div>
    </div>
  );
}

function MenuLink({ item, active, iconOnly = false, board = false }: { item: NavItem; active: boolean; iconOnly?: boolean; board?: boolean }) {
  const t = useT("shell");
  const { to, icon: Icon } = item;
  const label = navLabel(t, item.ns, "menu", item.key, item.label);
  return (
    <NavLink
      to={to}
      end={to === "/"}
      aria-current={active ? "page" : false}
      title={iconOnly ? label : undefined}
      className={
        iconOnly
          ? `flex h-10 items-center justify-center rounded-lg transition-colors ${active ? ITEM_ACTIVE : ITEM_IDLE}`
          : `${ITEM_BASE} ${itemSize(board)} ${active ? `${ITEM_ACTIVE} font-medium` : ITEM_IDLE}`
      }
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      {!iconOnly && <span className="truncate">{label}</span>}
    </NavLink>
  );
}
