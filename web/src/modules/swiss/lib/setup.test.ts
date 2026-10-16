import { describe, expect, it } from "vitest";
import { setupRedirect } from "@swiss/lib/setup";

const session = (initialized: boolean, setUp?: boolean) => ({ authenticated: true, initialized, setUp });

describe("setupRedirect", () => {
  it("sends a site with nothing stored to setup, and keeps it there", () => {
    expect(setupRedirect(session(false, false), "/")).toBe("/setup");
    expect(setupRedirect(session(false, false), "/site-profile")).toBe("/setup");
    expect(setupRedirect(session(false, false), "/setup")).toBeNull();
  });

  it("never opens setup on a site that is set up", () => {
    expect(setupRedirect(session(true, true), "/setup")).toBe("/site-profile");
    expect(setupRedirect(session(true, true), "/inferences/setup")).toBe("/site-profile");
    expect(setupRedirect(session(true, true), "/")).toBeNull();
    expect(setupRedirect(session(true, true), "/catalog")).toBeNull();
  });

  it("sends a stored profile that does not parse to the profile page, not setup", () => {
    expect(setupRedirect(session(false, true), "/")).toBe("/site-profile");
    expect(setupRedirect(session(false, true), "/setup")).toBe("/site-profile");
    expect(setupRedirect(session(false, true), "/site-profile")).toBeNull();
    expect(setupRedirect(session(false, true), "/inferences/site-profile")).toBeNull();
  });

  it("reads an older swissd's initialized as setUp", () => {
    expect(setupRedirect(session(false), "/")).toBe("/setup");
    expect(setupRedirect(session(false), "/setup")).toBeNull();
    expect(setupRedirect(session(true), "/setup")).toBe("/site-profile");
  });
});
