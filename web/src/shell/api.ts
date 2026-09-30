// Session and transport. Same-origin: console serves this SPA, its own API and
// every module backend it proxies. The token lives in a cookie (so a reload stays
// logged in and the server can read it on navigations) and is also sent as a
// Bearer header.

const TOKEN_COOKIE = "token";

export function getToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function setToken(token: string) {
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
}

export function clearToken() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// apiFetch is `fetch` with the session attached. Modules whose client was written
// against plain fetch (swiss's) swap it in and change nothing else.
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await apiFetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Me {
  name: string;
  groups: string[];
  email?: string;
  isAdmin: boolean;
  permissions: string[];
  requirePasswordReset: boolean;
  // Set when console runs with server.auth.disabled: there is no session to
  // end and no password to change, so the shell hides both.
  authDisabled?: boolean;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

// login exchanges credentials for a token at the OAuth2 password-grant endpoint
// (form-encoded, exactly as Rise Global expects) and stores it.
export async function login(username: string, password: string): Promise<void> {
  const form = new URLSearchParams({ grant_type: "password", username, password });
  const res = await fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new ApiError(res.status, "用户名或密码错误");
  }
  const tok = (await res.json()) as { access_token: string };
  setToken(tok.access_token);
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  changePassword: (passwords: ChangePasswordInput) =>
    request<{ status: string }>("POST", "/api/me/password", passwords),
};
