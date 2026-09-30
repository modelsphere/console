// swissd serving these pages itself: plain react-router, /api on the same origin,
// and swiss's own login. lib/host/console.ts is the other binding; both export
// the same names.
export { Link, Navigate, NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router";

export function apiPath(path: string): string {
  return path;
}

export const hostFetch: typeof fetch = (input, init) => fetch(input, init);

export const loginPath: string | null = "/login";
