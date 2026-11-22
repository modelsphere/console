import * as React from "react";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";
import * as Router from "react-router";
import * as Query from "@tanstack/react-query";
import * as ui from "@modelsphere/ui";
import { apiFetch, type Me } from "@/shell/api";
import { useAuth } from "@/shell/auth";
import { usePermissions } from "@/shell/permissions";
import { i18n, registerI18n, getLocale, getT, setLocale, useLocale, subscribeLocale as subscribeHostLocale, formatNumber, type Locale } from "@/shell/i18n";
import { apiClient } from "./api";
import { createRegistration } from "./runtime";

let currentUser: Me | null = null;

function useSDKPermissions(scope: { scope: string; value: string }) {
  const { has } = usePermissions();
  const { loading } = useAuth();
  return { hasPermission: has, loading, scopeType: scope.scope, scopeValue: scope.value };
}

export function GlobalSDKSession() {
  const { me } = useAuth();
  React.useLayoutEffect(() => { currentUser = me; return () => { currentUser = null; }; }, [me]);
  return null;
}

function navigate(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("SDK navigation must use a same-origin path");
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function createGlobalHost() {
  const registration = createRegistration();
  const getScope = () => registration.getScope(window.location.pathname);
  const host = {
    VERSION: "1.0.1", React, ReactJSXRuntime, ReactJSXDevRuntime, ...registration.sdk, apiClient, navigate, ui,
    business: { console: { Router, Query, i18n, apiFetch, useAuth, usePermissions } },
    get ScopeContext() { const context = getScope(); return { scope: context.scope, cluster: context.scope === "cluster" ? context.value : "", workspace: "", project: "" }; },
    get scope() { return getScope().scope; },
    get scopeValue() { return getScope().value; },
    getScope,
    getCanonicalPathname: () => window.location.pathname,
    usePermissions: () => { Router.useLocation(); return useSDKPermissions(getScope()); },
    get(name: string) {
      if (name !== "auth") throw new Error(`Unsupported SDK namespace "${name}"`);
      return {
        getUser: () => ({ username: currentUser?.name ?? "", email: currentUser?.email }),
        hasPermission: (key: string) => !!currentUser?.permissions.some((permission) => permission === "*" || permission === key),
      };
    },
    registerI18n, getPluginT: getT, t: getT("common"), getLocale,
    setLocale(locale: string) {
      if (locale !== "zh-CN" && locale !== "en-US") throw new Error(`Unsupported locale "${locale}"`);
      setLocale(locale as Locale);
    },
    subscribeLocale(callback: () => void) { return subscribeHostLocale(callback); },
    useLocale: () => useLocale().locale,
    formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(getLocale(), options).format(new Date(value)),
    formatNumber,
  };
  return { ...registration, host };
}

export type GlobalSDK = ReturnType<typeof createGlobalHost>["host"];

declare global {
  interface Window { __MODELSPHERE_SDK__: GlobalSDK; __GLOBAL_SDK__: GlobalSDK; __RISE_SDK__: GlobalSDK }
}
