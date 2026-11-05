import { apiFetch, ApiError } from "@/shell/api";

async function send<T>(method: string, path: string, body?: unknown) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("SDK requests must use same-origin paths");
  const response = await apiFetch(path, {
    method,
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, detail || response.statusText);
  }
  return { data: response.status === 204 ? undefined as T : await response.json() as T, status: response.status };
}

export const apiClient = {
  get<T = unknown>(path: string, options?: { params?: Record<string, unknown> }) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(options?.params ?? {})) if (value !== undefined && value !== null) query.set(name, String(value));
    return send<T>("GET", path + (query.size ? `${path.includes("?") ? "&" : "?"}${query}` : ""));
  },
  post: <T = unknown>(path: string, data?: unknown) => send<T>("POST", path, data),
  put: <T = unknown>(path: string, data?: unknown) => send<T>("PUT", path, data),
  patch: <T = unknown>(path: string, data?: unknown) => send<T>("PATCH", path, data),
  delete: <T = unknown>(path: string) => send<T>("DELETE", path),
};
