import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@riseaicloud/ui";
import { LogOut, Boxes, KeyRound, ChevronLeft, ChevronRight, PanelLeft, Palette } from "lucide-react";
import { useAuth } from "@/shell/auth";
import { usePermissions } from "@/shell/permissions";
import { ChangePasswordDialog } from "@/shell/ChangePasswordDialog";
import { PreferencesPanel } from "@/shell/PreferencesPanel";
import { useLayout } from "@/shell/preferences";
import { navGroups, type ConsoleModule, type NavGroup, type NavItem } from "@/shell/module";

// The console shell in Rise Global's layouts, picked in the preferences panel.
// Sizes, colours and classes follow rise-global console/src/components/layout
// (app-shell, scoped-sidebar-layout, collapsible-sidebar, top-nav) and were
// checked against a live Global console:
//
//   minimal    gradient canvas; transparent sidebar; header + page on one white rounded board
//   mixed-nav  full-width dark header; sidebar attached with a border; grey page
//   classic    as mixed-nav, but the sidebar is a floating card
//
// Collapse state and the preferences panel live here, outside the per-layout
// tree, so switching layout keeps both.
export function Layout({ modules, children }: { modules: ConsoleModule[]; children: ReactNode }) {
  const { has } = usePermissions();
  const layout = useLayout();
  const [collapsed, setCollapsed] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const groups = navGroups(modules, has);
  const toggle = () => setCollapsed((c) => !c);
  const page = <main className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-surface-page p-6">{children}</main>;

  const shell =
    layout === "minimal" ? (
      <div className="flex h-screen bg-[var(--shell-canvas)] [background-image:var(--shell-canvas-image)]">
        <aside className={`shrink-0 overflow-y-auto transition-[width] duration-200 ${collapsed ? "w-16" : "w-64"}`}>
          <nav className={collapsed ? "px-1 pb-1 pt-4" : "p-4"}>
            <Sidebar groups={groups} collapsed={collapsed} board />
          </nav>
        </aside>
        <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.1),0_1px_2px_-1px_rgb(0_0_0/0.1)]">
          <TopBar tone="light" collapse={{ collapsed, toggle }} onPreferences={() => setPrefsOpen(true)} />
          {page}
        </div>
      </div>
    ) : (
      <div className={`flex h-screen flex-col ${layout === "classic" ? "bg-[var(--shell-classic-canvas)]" : "bg-background"}`}>
        <TopBar tone="dark" onPreferences={() => setPrefsOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`flex shrink-0 flex-col bg-[var(--shell-sidebar)] transition-[width] duration-300 ${collapsed ? "w-16" : "w-64"} ${
              layout === "classic" ? "my-3 ml-3 rounded-lg" : "border-r border-[var(--shell-sidebar-border)]"
            }`}
          >
            <div className="flex-1 overflow-y-auto">
              <nav className={collapsed ? "px-1 pb-1 pt-4" : "p-4"}>
                <Sidebar groups={groups} collapsed={collapsed} />
              </nav>
            </div>
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                className="flex h-8 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>
          </aside>
          {page}
        </div>
      </div>
    );

  return (
    <>
      {shell}
      <PreferencesPanel open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
}

// Global's default chrome is a dark header except in minimal, where it is fixed
// to white on the board. Dark values are Global's measured .dark header.
const TONE = {
  light: {
    bar: "border-b bg-card text-[var(--shell-foreground)]",
    icon: "text-muted-foreground hover:bg-accent hover:text-foreground",
    logo: "text-primary",
    hover: "hover:bg-accent",
    avatar: "bg-primary/10 text-primary",
  },
  dark: {
    bar: "border-b border-[var(--shell-header-dark-border)] bg-[var(--shell-header-dark)] text-[var(--shell-header-dark-foreground)]",
    icon: "text-white/55 hover:bg-white/8 hover:text-white",
    logo: "text-[var(--shell-header-dark-primary)]",
    hover: "hover:bg-white/8",
    avatar: "bg-white/10 text-white",
  },
};

function TopBar({
  tone,
  collapse,
  onPreferences,
}: {
  tone: "light" | "dark";
  collapse?: { collapsed: boolean; toggle: () => void };
  onPreferences: () => void;
}) {
  const { me, logout } = useAuth();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const initial = me?.name?.[0]?.toUpperCase() ?? "?";
  const t = TONE[tone];

  return (
    <header className={`flex h-14 shrink-0 items-center gap-3 px-4 ${t.bar}`}>
      {collapse && (
        <button
          type="button"
          onClick={collapse.toggle}
          aria-label={collapse.collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${t.icon}`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}
      <NavLink to="/" className="flex items-center gap-2.5">
        <Boxes className={`h-[26px] w-[26px] shrink-0 ${t.logo}`} />
        <span className="text-sm font-semibold">ModelSphere</span>
      </NavLink>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onPreferences}
          aria-label="偏好设置"
          title="偏好设置"
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${t.icon}`}
        >
          <Palette className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${t.hover}`}>
              <Avatar className="h-7 w-7">
                <AvatarFallback className={`text-[13px] font-semibold ${t.avatar}`}>{initial}</AvatarFallback>
              </Avatar>
              <span className="text-[13px] font-medium">{me?.name}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {me?.name}
              {me?.isAdmin ? " · 管理员" : ""}
            </DropdownMenuLabel>
            {/* With auth disabled there is no session to end and no stored
                password to change; both entries would fail if offered. */}
            {!me?.authDisabled && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  修改密码
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </header>
  );
}

// Global's menu item. On the minimal board it is 14px/500 with 10px vertical
// padding (BOARD_MENU_ITEM); elsewhere regular weight with 8px.
const ITEM_BASE = "flex items-center gap-3 rounded-lg px-3 text-sm transition-colors";
const itemSize = (board: boolean) => (board ? "py-2.5 font-medium" : "py-2");
const ITEM_IDLE = "text-foreground/80 hover:bg-accent hover:text-foreground";
const ITEM_ACTIVE = "bg-primary/10 text-primary";

function isUnder(pathname: string, item: NavItem): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");
}

// Accordion like Global's sidebar: one group open at a time, starting with the
// group that holds the current page.
function Sidebar({ groups, collapsed, board = false }: { groups: NavGroup[]; collapsed: boolean; board?: boolean }) {
  const { pathname } = useLocation();
  const activeGroup = groups.find((g) => g.title && g.items.some((i) => isUnder(pathname, i)))?.title;
  const [open, setOpen] = useState<string | undefined>(activeGroup ?? groups.find((g) => g.title)?.title);
  const shown = open ?? activeGroup;
  // Navigating into another module (a link, the back button) opens its group.
  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {groups.flatMap((g) => g.items).map((item) => (
          <MenuLink key={item.to} item={item} iconOnly />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((g, i) =>
        !g.title ? (
          <div key={i} className="mb-1 space-y-0.5">
            {g.items.map((item) => (
              <MenuLink key={item.to} item={item} board={board} />
            ))}
          </div>
        ) : (
          <div key={g.title} className="mb-1">
            <button
              type="button"
              onClick={() => setOpen(shown === g.title ? "" : g.title)}
              className={`flex w-full items-center justify-between rounded-lg px-3 text-sm transition-colors hover:bg-accent ${itemSize(board)} ${
                g.title === activeGroup ? "text-primary" : "text-foreground/80"
              }`}
            >
              <span>{g.title}</span>
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${shown === g.title ? "rotate-90" : ""}`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                shown === g.title ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
              inert={shown !== g.title}
            >
              <div className="overflow-hidden">
                <div className="pl-4">
                  {g.items.map((item) => (
                    <MenuLink key={item.to} item={item} board={board} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function MenuLink({ item, iconOnly = false, board = false }: { item: NavItem; iconOnly?: boolean; board?: boolean }) {
  const { to, label, icon: Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      title={iconOnly ? label : undefined}
      className={({ isActive }) =>
        iconOnly
          ? `flex h-10 items-center justify-center rounded-lg transition-colors ${isActive ? ITEM_ACTIVE : ITEM_IDLE}`
          : `${ITEM_BASE} ${itemSize(board)} ${isActive ? `${ITEM_ACTIVE} font-medium` : ITEM_IDLE}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
          {!iconOnly && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}
