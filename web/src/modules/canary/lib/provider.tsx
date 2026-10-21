import { createContext, useContext, useMemo, type ReactNode } from "react";
import { CanaryI18nContext } from "./translation";
import type { i18n as I18n } from "i18next";
import { createLiveApi, type AuthFetch, type CanaryClient } from "./live-api";
import { registerCanaryLocales } from "../locales";
const ApiContext = createContext<CanaryClient | null>(null);
const WriteContext = createContext(true);
export function CanaryProvider({
  api,
  fetch: authFetch,
  i18n,
  canWrite = true,
  children,
}: {
  api?: CanaryClient;
  fetch?: AuthFetch;
  i18n?: I18n;
  canWrite?: boolean;
  children: ReactNode;
}) {
  const client = useMemo(
    () => api ?? createLiveApi(authFetch),
    [api, authFetch],
  );
  if (i18n) registerCanaryLocales(i18n);
  return (
    <ApiContext.Provider value={client}>
      <WriteContext.Provider value={canWrite}>
        {i18n ? (
          <CanaryI18nContext.Provider value={i18n}>
            {children}
          </CanaryI18nContext.Provider>
        ) : (
          children
        )}
      </WriteContext.Provider>
    </ApiContext.Provider>
  );
}
export function useCanaryApi() {
  const api = useContext(ApiContext);
  if (!api)
    throw new Error(
      "CanaryProvider is required; inject the Console authenticated fetch",
    );
  return api;
}
export function useCanaryWrite() {
  return useContext(WriteContext);
}
