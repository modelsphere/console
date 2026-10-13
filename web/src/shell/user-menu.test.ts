import { describe, expect, it } from "vitest";
import { userMenuIdentity, userMenuState } from "@/shell/user-menu";
import type { Me } from "@/shell/api";

const me = (over: Partial<Me> = {}): Me => ({
  name: "admin",
  groups: [],
  isAdmin: true,
  permissions: ["*"],
  requirePasswordReset: false,
  ...over,
});

describe("userMenuState", () => {
  it("offers both entries when console logs people in", () => {
    expect(userMenuState(me())).toEqual({ entries: ["changePassword", "logout"], noLogin: false });
  });

  it("draws no entries and says why when console runs without a login", () => {
    expect(userMenuState(me({ authDisabled: true }))).toEqual({ entries: [], noLogin: true });
  });

  it("keeps the entries when there is no session to read yet", () => {
    expect(userMenuState(null)).toEqual({ entries: ["changePassword", "logout"], noLogin: false });
  });
});

describe("userMenuIdentity", () => {
  it("carries the name and the role", () => {
    expect(userMenuIdentity(me())).toEqual({ name: "admin", role: "admin", email: undefined });
    expect(userMenuIdentity(me({ name: "li", isAdmin: false }))).toEqual({ name: "li", role: "member", email: undefined });
    expect(userMenuIdentity(null)).toEqual({ name: "", role: "member", email: undefined });
  });

  it("carries the email only when console has one to read", () => {
    expect(userMenuIdentity(me({ email: "admin@example.com" })).email).toBe("admin@example.com");
    expect(userMenuIdentity(me({ authDisabled: true })).email).toBeUndefined();
  });
});
