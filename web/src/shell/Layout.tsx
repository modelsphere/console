import { Fragment, useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  Avatar,
  AvatarFallback,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@modelsphere/ui";
import { LogOut, Boxes, KeyRound, ChevronLeft, ChevronRight, PanelLeft, Palette, Languages, Check } from "lucide-react";
import { useAuth } from "@/shell/auth";
import { usePermissions } from "@/shell/permissions";
import { ChangePasswordDialog } from "@/shell/ChangePasswordDialog";
import { PreferencesPanel } from "@/shell/PreferencesPanel";
import { useLayout } from "@/shell/preferences";
import { userMenuIdentity, userMenuState } from "@/shell/user-menu";
import { activeGroupTitle, navGroups, topbarItems, type ConsoleModule, type NavGroup, type NavItem } from "@/shell/module";
import { LOCALES, navLabel, useLocale, useT } from "@/shell/i18n";

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
  const t = useT("shell");
  const layout = useLayout();
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const groups = navGroups(modules, has);
  const links = topbarItems(modules, has);
  const toggle = () => setCollapsed((c) => !c);
  const page = <main className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-surface-page">{children}</main>;

  const shell =
    layout === "minimal" ? (
      <div className="flex h-screen bg-[var(--shell-canvas)] [background-image:var(--shell-canvas-image)]">
        <aside className={`shrink-0 overflow-y-auto transition-[width] duration-200 ${collapsed ? "w-16" : "w-64"}`}>
          <nav className={collapsed ? "px-1 pb-1 pt-4" : "p-4"}>
            <Sidebar groups={groups} collapsed={collapsed} board />
          </nav>
        </aside>
        <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_0_rgb(0_0_0/0.1),0_1px_2px_-1px_rgb(0_0_0/0.1)]">
          <TopBar tone="light" links={links} collapse={{ collapsed, toggle }} onPreferences={() => setPrefsOpen(true)} />
          {page}
        </div>
      </div>
    ) : (
      <div className={`flex h-screen flex-col ${layout === "classic" ? "bg-[var(--shell-classic-canvas)]" : "bg-background"}`}>
        <TopBar tone="dark" links={links} onPreferences={() => setPrefsOpen(true)} />
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
                aria-label={t(collapsed ? "layout.expandSidebar" : "layout.collapseSidebar")}
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
//
// chipWarn is the auth-disabled state on the user button itself: no extra element
// in the bar, the state rides on the identity. chipDot colours the dot's ring to
// whatever is behind the avatar, so it reads as a badge on both tones.
const TONE = {
  light: {
    bar: "border-b bg-card text-[var(--shell-foreground)]",
    icon: "text-muted-foreground hover:bg-accent hover:text-foreground",
    logo: "text-primary",
    hover: "hover:bg-accent",
    avatar: "bg-primary/10 text-primary",
    chipWarn: "bg-warning/10 text-warning shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_45%,transparent)]",
    chipDot: "ring-card",
  },
  dark: {
    bar: "border-b border-[var(--shell-header-dark-border)] bg-[var(--shell-header-dark)] text-[var(--shell-header-dark-foreground)]",
    icon: "text-white/55 hover:bg-white/8 hover:text-white",
    logo: "text-[var(--shell-header-dark-primary)]",
    hover: "hover:bg-white/8",
    avatar: "bg-white/10 text-white",
    chipWarn: "bg-warning/10 text-warning shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-warning)_45%,transparent)]",
    chipDot: "ring-[var(--shell-header-dark)]",
  },
};

function TopBar({
  tone,
  links,
  collapse,
  onPreferences,
}: {
  tone: "light" | "dark";
  links: NavItem[];
  collapse?: { collapsed: boolean; toggle: () => void };
  onPreferences: () => void;
}) {
  const { me, logout } = useAuth();
  const tr = useT("shell");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const initial = me?.name?.[0]?.toUpperCase() ?? "?";
  const menu = userMenuState(me);
  const identity = userMenuIdentity(me);
  const t = TONE[tone];

  return (
    <header className={`flex h-14 shrink-0 items-center gap-3 px-4 ${t.bar}`}>
      {collapse && (
        <button
          type="button"
          onClick={collapse.toggle}
          aria-label={tr(collapse.collapsed ? "layout.expandSidebar" : "layout.collapseSidebar")}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${t.icon}`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}
      <NavLink to="/" aria-label="ModelSphere" className="flex shrink-0 items-center gap-2.5">
        <Boxes className={`h-[26px] w-[26px] shrink-0 ${t.logo}`} />
        <span className="hidden text-sm font-semibold sm:inline">ModelSphere</span>
      </NavLink>

      <div className="ml-auto flex items-center gap-1">
        {links.map((item) => {
          const Icon = item.icon;
          const label = navLabel(tr, item.ns, "menu", item.key, item.label);
          return (
            <NavLink key={item.to} to={item.to} aria-label={label} title={label} className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] transition-colors ${t.icon}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          );
        })}
        <LocaleMenu iconClass={t.icon} />
        <button
          type="button"
          onClick={onPreferences}
          aria-label={tr("layout.preferences")}
          title={tr("layout.preferences")}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${t.icon}`}
        >
          <Palette className="h-4 w-4" />
        </button>
        {/* The state belongs in the bar, not only behind the avatar: with no
            login every request is the administrator, and that is worth knowing
            before opening anything. It rides on the user button itself, so the
            bar gains no element. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            title={menu.noLogin ? tr("layout.noLogin") : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${menu.noLogin ? t.chipWarn : t.hover}`}
          >
            <span className="relative flex shrink-0">
              <Avatar className="h-7 w-7">
                <AvatarFallback className={`text-[13px] font-semibold ${menu.noLogin ? "bg-warning/20 text-warning" : t.avatar}`}>{initial}</AvatarFallback>
              </Avatar>
              {menu.noLogin && <span aria-hidden className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning ring-2 ${t.chipDot}`} />}
            </span>
            <span className="hidden text-[13px] font-medium sm:inline">{me?.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2.5 px-1.5 py-2 font-normal">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary">{initial}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{identity.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{tr(`layout.${identity.role}`)}</span>
                  {identity.email && <span className="block truncate text-xs text-muted-foreground">{identity.email}</span>}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {menu.noLogin && (
              <>
                <DropdownMenuSeparator />
                <Badge variant="warning" className="h-auto w-full justify-start px-2 py-1 text-left leading-snug whitespace-normal">
                  {tr("layout.noLogin")}
                </Badge>
              </>
            )}
            {menu.entries.map((entry) => {
              const Icon = entry === "changePassword" ? KeyRound : LogOut;
              return (
                <Fragment key={entry}>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={entry === "changePassword" ? () => setChangePasswordOpen(true) : logout}>
                    <Icon className="mr-2 h-4 w-4" />
                    {tr(entry === "changePassword" ? "layout.changePassword" : "layout.logout")}
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </header>
  );
}

// Global's top-bar language widget: same locale state as the preferences
// panel's switch, drawn as an icon so it fits both header tones.
function LocaleMenu({ iconClass }: { iconClass: string }) {
  const t = useT("shell");
  const { locale, setLocale } = useLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("layout.language")}
        title={t("layout.language")}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${iconClass}`}
      >
        <Languages className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l.value} onClick={() => setLocale(l.value)}>
            <Check className={`mr-2 h-4 w-4 ${l.value === locale ? "" : "invisible"}`} />
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Global's menu item. On the minimal board it is 14px/500 with 10px vertical
// padding (BOARD_MENU_ITEM); elsewhere regular weight with 8px.
const ITEM_BASE = "flex items-center gap-3 rounded-lg px-3 text-sm transition-colors";
const itemSize = (board: boolean) => (board ? "py-2.5 font-medium" : "py-2");
const ITEM_IDLE = "text-foreground/80 hover:bg-accent hover:text-foreground";
const ITEM_ACTIVE = "bg-primary/10 text-primary";

// Accordion like Global's sidebar: one group open at a time, starting with the
// group that holds the current page.
function Sidebar({ groups, collapsed, board = false }: { groups: NavGroup[]; collapsed: boolean; board?: boolean }) {
  const { pathname } = useLocation();
  const t = useT("shell");
  const activeGroup = activeGroupTitle(groups, pathname);
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
              <span>{navLabel(t, g.ns, "group", g.title, g.title)}</span>
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
  const t = useT("shell");
  const { to, icon: Icon, end } = item;
  const label = navLabel(t, item.ns, "menu", item.key, item.label);
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
