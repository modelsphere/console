import type { Me } from "@/shell/api";

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
