import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "@/shell/api";
import { DEFAULT_LOCALE, getT, setLocale, type Locale } from "@/shell/i18n";

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale(DEFAULT_LOCALE);
});

describe.each<Locale>(["en-US", "zh-CN"])("login in %s", (locale) => {
  beforeEach(() => {
    setLocale(locale);
    vi.stubGlobal("document", { cookie: "token=existing" });
  });

  it("keeps invalid credentials generic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 401 })));
    await expect(login("missing", "wrong")).rejects.toMatchObject({
      status: 401,
      message: getT("shell")("login.badCredentials"),
    });
    expect(document.cookie).toBe("token=existing");
  });

  it("reports service failures without exposing the response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "server_error" }, { status: 500 })));
    const message = getT("shell")("login.serviceUnavailable");
    expect(message).not.toBe("login.serviceUnavailable");
    await expect(login("admin", "test-password")).rejects.toMatchObject({
      status: 500,
      message,
    });
    expect(document.cookie).toBe("token=existing");
  });

  it("gives recovery guidance when the browser cannot reach the service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(login("admin", "test-password")).rejects.toMatchObject({
      status: 0,
      message: getT("shell")("login.serviceUnavailable"),
    });
    expect(document.cookie).toBe("token=existing");
  });

  it("keeps the password grant and stores a successful token", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ access_token: "test/token" }));
    vi.stubGlobal("fetch", fetch);
    await login("name+space", "pass&word");
    expect(fetch).toHaveBeenCalledWith("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=password&username=name%2Bspace&password=pass%26word",
    });
    expect(document.cookie).toBe("token=test%2Ftoken; path=/; SameSite=Lax");
  });
});
