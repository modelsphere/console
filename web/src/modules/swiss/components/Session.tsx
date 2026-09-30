import { createContext, use, useEffect } from "react";
import { loginPath, Navigate, useLocation } from "@swiss/lib/host";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, onUnauthorized, type Session } from "@swiss/lib/api";
import { ErrorState, Loading } from "@swiss/components/States";

// The session is asked for once, at the root, and read from everywhere else.
// Every page under it is already past the login, so nothing below has to think
// about whether it is authenticated.
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = use(SessionContext);
  if (!s) throw new Error("useSession outside a Session gate");
  return s;
}

export function useSessionQuery(): UseQueryResult<Session> {
  return useQuery({
    queryKey: ["session"],
    queryFn: api.session,
    // The login can end while a tab sits open; the next check notices.
    staleTime: 60_000,
    retry: false,
  });
}

// Gate is what every page is rendered inside: not logged in goes to the login,
// and a site with no profile yet goes to the setup page before anything else --
// there is nothing to show until swissd knows what this cluster looks like.
export function Gate({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();
  const { pathname } = useLocation();
  const qc = useQueryClient();

  // A login can end while a page sits open. Any 401 re-asks for the session,
  // which then comes back unauthenticated and lands on the login below.
  useEffect(() => {
    onUnauthorized(() => qc.invalidateQueries({ queryKey: ["session"] }));
    return () => onUnauthorized(null);
  }, [qc]);

  if (session.isPending) return <Loading what="the session" />;
  if (session.error) return <ErrorState what="the session" error={session.error} />;

  // Under console there is no swiss login, so a swissd behind it must run with server.auth.disabled.
  if (!session.data.authenticated) {
    if (loginPath) return <Navigate to={loginPath} replace state={{ from: pathname }} />;
    return <ErrorState what="swissd" error={new Error("swissd asks for its own login; run it with server.auth.disabled behind console")} />;
  }
  if (!session.data.initialized && !pathname.endsWith("/setup")) {
    return <Navigate to="/setup" replace />;
  }
  return <SessionContext value={session.data}>{children}</SessionContext>;
}
