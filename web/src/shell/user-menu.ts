import type { Me } from "@/shell/api";
import type { ApplicationItem } from "./applications";
import type { ConsoleModule } from "./module";
import { entryRegistry, entryVisible } from "./navigation-registry";

// What the avatar menu draws, apart from how: the shell is the only place that
// knows both the identity and the auth mode.
export type UserMenuEntry = "changePassword" | "logout";

export interface UserMenuState {
  // Auth disabled: console can honour neither entry — there is no session to end
  // and no stored password to change — so the notice below stands in for them
  // and no dead rows are drawn.
  entries: UserMenuEntry[];
  // Console running without a login: every request is the synthetic
  // administrator, and the menu says so.
  noLogin: boolean;
}

export function userMenuState(me: Me | null): UserMenuState {
  const noLogin = me?.authDisabled === true;
  return { entries: noLogin ? [] : ["changePassword", "logout"], noLogin };
}

export interface UserMenuIdentity {
  name: string;
  role: "admin" | "member";
  email?: string;
}

// The synthetic administrator of an auth-disabled install is not a User CRD, so
// it has no email to read.
export function userMenuIdentity(me: Me | null): UserMenuIdentity {
  return {
    name: me?.name ?? "",
    role: me?.isAdmin ? "admin" : "member",
    email: me?.email || undefined,
  };
}

export interface UserMenuLink {
  key: string;
  id: string;
  namespace: string;
  title: string;
  to: string;
  order: number;
}

export function resolveUserMenuItems(
  modules: ConsoleModule[],
  applications: ApplicationItem[],
  has: (permission: string) => boolean,
): UserMenuLink[] {
  if (!modules.some(module => module.userMenu?.length)) return [];
  const entries = entryRegistry(modules);
  const links: UserMenuLink[] = [];
  for (const module of modules) {
    for (const { id, title, target, order = 999 } of module.userMenu ?? []) {
      let to: string | undefined;
      if (target.kind === "application") {
        to = applications.find(application => application.id === target.id)?.to;
      } else {
        const entry = entries.find(entry => entry.module === module && entry.name === target.name);
        if (entry && !/[:*]/.test(entry.path) && entryVisible(entry, entries, has)) to = entry.path;
      }
      if (to) links.push({ key: `${module.id}:${id}`, id, namespace: module.id, title, to, order });
    }
  }
  return links.sort((left, right) =>
    left.order - right.order || left.namespace.localeCompare(right.namespace) || left.id.localeCompare(right.id),
  );
}
