import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";
import i18next, { type i18n as I18n } from "i18next";
import ICU from "i18next-icu";
import { configureUiI18n, uiLocales } from "@modelsphere/ui/i18n-host";
import commonZh from "@/shell/locales/common.zh-CN.json";
import commonEn from "@/shell/locales/common.en-US.json";
import shellZh from "@/shell/locales/shell.zh-CN.json";
import shellEn from "@/shell/locales/shell.en-US.json";

// Rise Global's i18n engine (console/src/i18n/engine.ts), cut to what this
// console renders: one i18next instance, ICU messages, one namespace per module.
// Same storage key and locales as Global, so the choice carries over on upgrade.
// The model is in docs/console-design.md, "i18n".

export const LOCALE_STORAGE_KEY = "rise-locale";
export const LOCALES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
] as const;
export type Locale = (typeof LOCALES)[number]["value"];
export const DEFAULT_LOCALE: Locale = "zh-CN";

export type TFn = (key: string, options?: Record<string, unknown>) => string;

function isLocale(v: unknown): v is Locale {
  return LOCALES.some((l) => l.value === v);
}

// readLocale: a stored choice wins, then the browser's language, then Chinese.
export function readLocale(storage: Pick<Storage, "getItem"> | undefined, languages: readonly string[] = []): Locale {
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage blocked: fall through */
  }
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0];
    const hit = LOCALES.find((l) => l.value.toLowerCase().split("-")[0] === base);
    if (hit) return hit.value;
  }
  return DEFAULT_LOCALE;
}

const browser = typeof window !== "undefined";

export const i18n: I18n = i18next.createInstance();
// initAsync:false makes the bundled resources ready synchronously: the first
// render already has its strings.
void i18n.use(ICU).init({
  lng: browser ? readLocale(localStorage, navigator.languages) : DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  ns: ["common", "shell", "ui"],
  defaultNS: "common",
  fallbackNS: "common",
  resources: {
    "zh-CN": { common: commonZh, shell: shellZh, ui: uiLocales["zh-CN"] },
    "en-US": { common: commonEn, shell: shellEn, ui: uiLocales["en-US"] },
  },
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  initAsync: false,
});
if (browser) document.documentElement.lang = i18n.language;

export function getLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  if (locale === i18n.language) return;
  void i18n.changeLanguage(locale);
  if (!browser) return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale;
}

// subscribeLocale fires on a language switch and whenever a bundle arrives.
// Plugins load after the shell's first render and register their strings then;
// a label computed before that would otherwise keep the fallback literal.
// Bundles land on the resource store, which emits its own "added": i18next does
// not forward it to the instance, so `i18n.on("added")` never fires.
export function subscribeLocale(cb: () => void): () => void {
  i18n.on("languageChanged", cb);
  i18n.store.on("added", cb);
  return () => {
    i18n.off("languageChanged", cb);
    i18n.store.off("added", cb);
  };
}

function subscribe(cb: () => void): () => void {
  const stop = subscribeLocale(cb);
  // Another tab switched: follow.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCALE_STORAGE_KEY && isLocale(e.newValue)) setLocale(e.newValue);
  };
  if (browser) window.addEventListener("storage", onStorage);
  return () => {
    stop();
    if (browser) window.removeEventListener("storage", onStorage);
  };
}

// @modelsphere/ui's own strings (table pagination, confirm buttons, …) render
// through this instance, in the locale the component asks for.
const uiTByLocale = new Map<string, TFn>();
configureUiI18n({
  t: (lng, key, vars) => {
    let fn = uiTByLocale.get(lng);
    if (!fn) {
      fn = i18n.getFixedT(lng, "ui") as unknown as TFn;
      uiTByLocale.set(lng, fn);
    }
    return fn(key, vars);
  },
  subscribe: (cb) => {
    i18n.on("languageChanged", cb);
    return () => i18n.off("languageChanged", cb);
  },
  getLocale,
});

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const locale = useSyncExternalStore<Locale>(subscribe, getLocale, () => DEFAULT_LOCALE);
  return { locale, setLocale };
}

// registerI18n adds a module's strings under its namespace; call it at import
// time, next to the module's declaration. Repeated calls merge.
export function registerI18n(ns: string, resources: Partial<Record<Locale, object>>): void {
  for (const [lng, res] of Object.entries(resources)) {
    if (res) i18n.addResourceBundle(lng, ns, res, true, true);
  }
}

// One function object per (locale, ns): a fresh getFixedT on every render would
// change identity and re-run every effect or callback that depends on `t`
// (Global hit exactly that as a request loop).
const cache = new Map<string, TFn>();
i18n.on("languageChanged", () => cache.clear());

export function getT(ns: string): TFn {
  const key = `${getLocale()}:${ns}`;
  let fn = cache.get(key);
  if (!fn) {
    fn = i18n.getFixedT(null, ns) as unknown as TFn;
    cache.set(key, fn);
  }
  return fn;
}

// useT re-renders the caller when the locale changes.
export function useT(ns: string): TFn {
  useLocale();
  return getT(ns);
}

// tNodes is `t` for messages with a React node in them: `{model}` in the
// message is replaced by nodes.model.
const MARK = "\u0001";
export function tNodes(t: TFn, key: string, nodes: Record<string, ReactNode>, values: Record<string, unknown> = {}): ReactNode {
  const marked = Object.fromEntries(Object.keys(nodes).map((k) => [k, `${MARK}${k}${MARK}`]));
  const parts = t(key, { ...values, ...marked }).split(MARK);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 === 1 && part in nodes ? createElement(Fragment, { key: i }, nodes[part]) : part)),
  );
}

export function formatDateTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(getLocale(), { hour12: false });
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(getLocale(), options);
}

// ── Navigation labels ───────────────────────────────────────────────────────
// As in Global (ADR-0011): a module declares its sidebar in Chinese, the
// literal is the zh-CN text. Other languages look the label up by a key derived
// from the declaration and fall back to the literal:
//
//   group  {module id}:group.{title}       title is the Chinese literal
//   menu   {module id}:menu.{page key}     pageKey("api-keys") === "apiKeys", pageKey("") === "index"

export function pageKey(path: string): string {
  const key = path
    .replace(/:/g, "")
    .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
  return key || "index";
}

export function navLabel(t: TFn, ns: string | undefined, kind: "group" | "menu", key: string, fallback: string): string {
  if (!ns) return fallback;
  const full = `${kind}.${key}`;
  const v = t(`${ns}:${full}`, { defaultValue: full });
  return v && v !== full ? v : fallback;
}
