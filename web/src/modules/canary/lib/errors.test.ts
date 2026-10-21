import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18next from "i18next";
import ICU from "i18next-icu";
import { describe, expect, it } from "vitest";
import { asError, CanaryApiError, describeError } from "./errors";
import { canaryLocales, registerCanaryLocales } from "../locales";
import { createLiveApi } from "./live-api";
import { fromYamlObject } from "./yaml";
import { CanaryI18nContext } from "./translation";
import { ErrorNotice } from "../components/ErrorNotice";
function translator(language: string) {
  const i18n = i18next.createInstance().use(ICU);
  void i18n.init({
    lng: language,
    fallbackLng: "en",
    initAsync: false,
    defaultNS: "canary",
    resources: {
      en: { canary: canaryLocales.en },
      zh: { canary: canaryLocales.zh },
    },
  });
  registerCanaryLocales(i18n);
  return i18n;
}
describe("localized UI errors", () => {
  it("translates backend name and namespace validation, including the old combined error", () => {
    const zh = translator("zh-CN").getFixedT("zh-CN", "canary"),
      en = translator("en-US").getFixedT("en-US", "canary");
    expect(
      describeError(
        new Error("invalid canary name (maximum 28 characters)"),
        zh,
      ).summary,
    ).toContain("实验名称无效");
    expect(
      describeError(
        new Error("invalid canary namespace (maximum 63 characters)"),
        zh,
      ).summary,
    ).toContain("命名空间无效");
    const old = new Error(
      "invalid canary name (maximum 28 characters) or namespace",
    );
    expect(describeError(old, zh).summary).toContain("28");
    expect(describeError(old, zh).summary).toContain("63");
    expect(describeError(old, en).summary).toContain("namespace");
    expect(describeError(old, zh).details).toBe(old.message);
  });
  it.each([401, 403, 404, 409, 413, 429, 500, 502, 503])(
    "preserves HTTP %i and localizes non-JSON responses",
    async (status) => {
      const api = createLiveApi(
        async () => new Response("<html>gateway failure</html>", { status }),
      );
      const error = await api.experiments.list().catch((e) => e);
      expect(error.status).toBe(status);
      expect(error.message).toBe(`HTTP ${status}`);
      const zh = describeError(
        error,
        translator("zh").getFixedT("zh", "canary"),
      );
      const en = describeError(
        error,
        translator("en").getFixedT("en", "canary"),
      );
      expect(zh.summary).not.toBe(en.summary);
      expect(zh.summary).not.toContain("HTTP");
      expect(zh.details).toBe(`HTTP ${status}`);
    },
  );
  it("keeps conflict specifics instead of replacing them with a generic status", async () => {
    const api = createLiveApi(
      async () =>
        new Response(
          JSON.stringify({ error: "pricing changed; reload before saving" }),
          { status: 409 },
        ),
    );
    const error = await api.pricing.get().catch((e) => e);
    expect(
      describeError(error, translator("zh").getFixedT("zh", "canary")).summary,
    ).toBe("价格已变更，请重新加载价表后再保存。");
  });
  it("localizes transport failure and rejects malformed successful responses", async () => {
    const t = translator("zh").getFixedT("zh", "canary");
    const offline = createLiveApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      describeError(await offline.config().catch((e) => e), t).summary,
    ).toContain("无法连接服务器");
    const invalid = createLiveApi(async () => new Response("not json"));
    expect(
      describeError(await invalid.config().catch((e) => e), t).summary,
    ).toContain("数据格式无效");
  });
  it("preserves structured error parameters and ignores translation options from the payload", async () => {
    const api = createLiveApi(
      async () =>
        new Response(
          JSON.stringify({
            error: "raw",
            code: "namespaceDisabled",
            params: {
              namespace: "test-{scope}",
              lng: "en",
              returnObjects: true,
            },
          }),
          { status: 400 },
        ),
    );
    const error = await api.config().catch((e) => e);
    expect(
      describeError(error, translator("zh").getFixedT("zh", "canary")).summary,
    ).toBe("命名空间 test-{scope} 未启用实验功能。");
    expect(
      describeError(
        new CanaryApiError("new server error", 400, "notYetKnown"),
        translator("zh").getFixedT("zh", "canary"),
      ).summary,
    ).toContain("请求失败");
  });
  it("localizes validation paths, wrapped arm errors and compound snapshot failures", () => {
    const t = translator("zh").getFixedT("zh", "canary");
    expect(
      describeError(
        'arm candidate: arm candidate pricing key "model.v2" is not configured',
        t,
      ).summary,
    ).toContain("model.v2 尚未配置");
    expect(describeError('duplicate arm name "baseline"', t).summary).toBe(
      "实验臂名称 baseline 重复。",
    );
    expect(
      describeError(
        "spec.gateway.name: required; spec.traffic: weights must be integers >= 0",
        t,
      ).summary,
    ).toContain("流量权重必须为非负整数");
    const raw =
      "arm baseline never reported in the measurement window; arm candidate reported nothing in the minute ending 2026-10-21T04:00:00Z";
    const result = describeError(raw, t, "snapshot");
    expect(result.summary).toContain("baseline 在观测窗口内没有上报数据");
    expect(result.summary).toContain("2026-10-21T04:00:00Z");
    expect(result.details).toBe(raw);
  });
  it("keeps YAML errors as objects and translates syntax locations, shape and recursion", () => {
    const t = translator("zh").getFixedT("zh", "canary");
    let syntax: unknown;
    try {
      fromYamlObject("image: [");
    } catch (e) {
      syntax = e;
    }
    expect(describeError(syntax, t).summary).toMatch(
      /YAML 第 \d+ 行、第 \d+ 列/,
    );
    expect(describeError(syntax, t).details).toContain("unexpected end");
    let recursive: unknown;
    try {
      fromYamlObject("a: &x\n  b: *x");
    } catch (e) {
      recursive = e;
    }
    expect(describeError(recursive, t).summary).toContain("递归别名");
    expect(
      describeError("YAML must be an object with named keys.", t).summary,
    ).toBe("YAML 必须是包含命名字段的对象。");
  });
  it("changes an already displayed error with the language and escapes diagnostics", async () => {
    const i18n = translator("zh");
    const error = new CanaryApiError("<script>alert('raw')</script>", 403);
    const render = () =>
      renderToStaticMarkup(
        createElement(
          CanaryI18nContext.Provider,
          { value: i18n },
          createElement(ErrorNotice, { error }),
        ),
      );
    const zh = render();
    expect(zh).toContain("你没有执行此操作的权限");
    expect(zh).toContain("技术详情（原始信息）");
    expect(zh).not.toContain("<script>");
    await i18n.changeLanguage("en");
    const en = render();
    expect(en).toContain("You do not have permission");
    expect(en).toContain("Technical details (original message)");
    expect(en).toContain("&lt;script&gt;");
    expect(
      describeError("constructor", i18n.getFixedT("en", "canary")).summary,
    ).toContain("request failed");
    expect(
      describeError(
        asError({ message: "denied", status: 403 }),
        i18n.getFixedT("en", "canary"),
      ).summary,
    ).toContain("permission");
  });
});
