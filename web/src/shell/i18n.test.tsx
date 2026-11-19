import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import { DEFAULT_LOCALE, LOCALES, getT, i18n, navLabel, pageKey, readLocale, registerI18n, setLocale, subscribeLocale, tNodes } from "@/shell/i18n";
import { modules } from "@/modules";
import { navGroups } from "@/shell/module";

afterEach(() => setLocale(DEFAULT_LOCALE));

const storage = (v: string | null) => ({ getItem: () => v });

describe("readLocale", () => {
  it("prefers the stored choice", () => {
    expect(readLocale(storage("en-US"), ["zh-CN"])).toBe("en-US");
  });

  it("ignores a stored value it does not support, then follows the browser", () => {
    expect(readLocale(storage("ko-KR"), ["en-GB", "zh-CN"])).toBe("en-US");
  });

  it("falls back to Chinese", () => {
    expect(readLocale(storage(null), ["fr-FR"])).toBe("zh-CN");
    expect(readLocale(undefined)).toBe("zh-CN");
  });
});

describe("pageKey", () => {
  it.each([
    ["", "index"],
    ["users", "users"],
    ["login-history", "loginHistory"],
    ["site-profile", "siteProfile"],
    ["catalog/:name", "catalogName"],
  ])("%j -> %s", (path, key) => expect(pageKey(path)).toBe(key));
});

describe("navLabel", () => {
  registerI18n("navtest", { "en-US": { group: { 测试: "Test" }, menu: { index: "Home" } } });

  it("shows the Chinese literal in Chinese", () => {
    expect(navLabel(getT("shell"), "navtest", "menu", "index", "首页")).toBe("首页");
  });

  it("looks the label up in English and falls back to the literal", () => {
    setLocale("en-US");
    const t = getT("shell");
    expect(navLabel(t, "navtest", "group", "测试", "测试")).toBe("Test");
    expect(navLabel(t, "navtest", "menu", "index", "首页")).toBe("Home");
    expect(navLabel(t, "navtest", "menu", "missing", "缺失")).toBe("缺失");
    expect(navLabel(t, undefined, "menu", "index", "首页")).toBe("首页");
  });
});

describe("tNodes", () => {
  it("puts React nodes where the message names them", () => {
    registerI18n("nodetest", { "zh-CN": { hi: "与 {model} 对话，共 {n} 轮" } });
    const html = renderToStaticMarkup(<>{tNodes(getT("nodetest"), "hi", { model: <b>qwen</b> }, { n: 2 })}</>);
    expect(html).toBe("与 <b>qwen</b> 对话，共 2 轮");
  });
});

describe("subscribeLocale", () => {
  it("notifies when a bundle arrives after the first render", () => {
    let hits = 0;
    const stop = subscribeLocale(() => hits++);
    registerI18n("late.bundle", { "en-US": { menu: { late: "Late" } } });
    stop();
    expect(hits).toBeGreaterThan(0);
  });

  it("stops notifying once unsubscribed", () => {
    let hits = 0;
    subscribeLocale(() => hits++)();
    registerI18n("late.after", { "en-US": { menu: { late: "Late" } } });
    expect(hits).toBe(0);
  });
});

describe("getT", () => {
  it("returns one function per locale and namespace, so effects keyed on t stay put", () => {
    expect(getT("shell")).toBe(getT("shell"));
    const zh = getT("shell");
    setLocale("en-US");
    expect(getT("shell")).not.toBe(zh);
  });
});

// ── The string tables ───────────────────────────────────────────────────────

const files = import.meta.glob<{ default: Record<string, unknown> }>("/src/**/locales/*.json", { eager: true });
const NAV = new Set(["group", "menu"]);

function leaves(obj: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof obj === "string") out.set(prefix, obj);
  else if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) if (!(prefix === "" && NAV.has(k))) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const tables = Object.entries(files).map(([path, mod]) => {
  const m = path.match(/^(.*)\/([^/]*?)\.?([a-z]{2}-[A-Z]{2})\.json$/)!;
  return { path, set: `${m[1]}/${m[2]}`, locale: m[3], strings: leaves(mod.default) };
});

describe("locale files", () => {
  it("are found", () => {
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });

  it("have the same keys in every language", () => {
    const sets = new Map<string, typeof tables>();
    for (const t of tables) sets.set(t.set, [...(sets.get(t.set) ?? []), t]);
    for (const [set, group] of sets) {
      expect(group.map((g) => g.locale).sort(), set).toEqual(LOCALES.map((l) => l.value).sort());
      const [first, ...rest] = group;
      for (const other of rest) expect([...other.strings.keys()].sort(), `${other.path} vs ${first.path}`).toEqual([...first.strings.keys()].sort());
    }
  });

  it("are valid ICU messages, with no i18next {{double}} braces", () => {
    for (const { path, locale, strings } of tables) {
      for (const [key, msg] of strings) {
        expect(msg, `${path} ${key}`).not.toMatch(/\{\{/);
        expect(() => new IntlMessageFormat(msg, locale), `${path} ${key}`).not.toThrow();
      }
    }
  });

  it("keep sidebar labels out of zh-CN: the module declaration is the Chinese", () => {
    for (const { path, locale } of tables) {
      if (locale !== "zh-CN") continue;
      const raw = files[path].default;
      expect(Object.keys(raw).filter((k) => NAV.has(k)), path).toEqual([]);
    }
  });
});

describe("sidebar", () => {
  it("has an English label for every module group and menu entry", () => {
    setLocale("en-US");
    const t = getT("shell");
    const missing: string[] = [];
    for (const g of navGroups(modules, () => true)) {
      if (g.title && !i18n.exists(`${g.ns}:group.${g.title}`)) missing.push(`${g.ns}:group.${g.title}`);
      for (const item of g.items) {
        if (navLabel(t, item.ns, "menu", item.key, "") === "") missing.push(`${item.ns}:menu.${item.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
