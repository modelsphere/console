import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearToken, login as apiLogin, type Me } from "@/shell/api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, ask who the caller is. A stale or invalid token simply resolves
  // to logged-out -- and so does no token at all, except when console runs
  // with auth disabled, where the probe succeeds and nobody sees a login page.
  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => {
        clearToken();
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    await apiLogin(username, password);
    setMe(await api.me());
  };

  const logout = () => {
    clearToken();
    setMe(null);
  };


  return <AuthContext.Provider value={{ me, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
