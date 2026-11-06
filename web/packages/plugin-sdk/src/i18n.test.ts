import { afterEach, describe, expect, it, vi } from 'vitest'

import enUS from './locales/sdk.en-US'
import zhCN from './locales/sdk.zh-CN'
import { SDK_I18N_NS, renderFallback, resetSdkI18nForTest, sdkKey, sdkT, useSdkT } from './i18n'

function setHost(sdk: unknown): void {
  ;(globalThis as any).__RISE_SDK__ = sdk
}

afterEach(() => {
  delete (globalThis as any).__RISE_SDK__
  resetSdkI18nForTest()
})

/** 展平成 `a.b.c` → 字符串，用来比两侧词表的键集合。 */
function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else flatten(v, key, out)
  }
  return out
}

describe('SDK 词表', () => {
  it('中英键集合一致', () => {
    expect(Object.keys(flatten(enUS)).sort()).toEqual(Object.keys(flatten(zhCN)).sort())
  })

  it('两侧插值参数一一对应', () => {
    const zh = flatten(zhCN)
    const en = flatten(enUS)
    for (const key of Object.keys(zh)) {
      const vars = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()
      expect(vars(en[key]), key).toEqual(vars(zh[key]))
    }
  })

  /*
    花括号里只能是 ICU 参数名。宿主是 i18next-icu，单花括号即参数 —— 往里塞 JSX、代码片段
    或中文，整条会 MALFORMED_ARGUMENT、在页面上渲染成 key 原文（freeland#1493 踩过 96 条）。
    这条不靠注释约束，靠这里拦。
  */
  it('花括号里只有参数名', () => {
    for (const [key, value] of Object.entries({ ...flatten(zhCN), ...flatten(enUS) })) {
      for (const seg of value.match(/\{[^}]*\}/g) ?? []) {
        expect(seg, `${key}: ${seg}`).toMatch(/^\{\w+\}$/)
      }
    }
  })

  it('花括号成对', () => {
    for (const [key, value] of Object.entries({ ...flatten(zhCN), ...flatten(enUS) })) {
      expect((value.match(/\{/g) ?? []).length, key).toBe((value.match(/\}/g) ?? []).length)
    }
  })

  it('英文侧不残留中文', () => {
    for (const [key, value] of Object.entries(flatten(enUS))) {
      expect(value, key).not.toMatch(/[一-鿿]/)
    }
  })
})

describe('没有宿主时', () => {
  it('回落中文词表，不抛', () => {
    expect(sdkT('resourceApi.error.network')).toBe('网络连接失败，请检查网络设置。')
  })

  it('回落路径也做插值', () => {
    expect(renderFallback('加载失败：{reason}', { reason: 'HTTP 500' })).toBe('加载失败：HTTP 500')
  })

  it('查不到的 key 原样返回，不抛', () => {
    expect(sdkT('resourceApi.nope')).toBe('resourceApi.nope')
  })

  /*
    spec §4.2 约束 3：未注入宿主时除了插值，还要按 ICU 规则还原引号转义。
    不还原的话中文界面在单测 / SSR 路径下会把转义符原样印出来。
  */
  it("'{…}' 还原成字面花括号", () => {
    expect(renderFallback("格式应为 '{项目名}'/'{制品名}'")).toBe('格式应为 {项目名}/{制品名}')
  })

  it("'' 还原成单撇号", () => {
    expect(renderFallback("the caller''s value")).toBe("the caller's value")
  })

  it('转义后的花括号不被当成插值', () => {
    expect(renderFallback("留 '{name}' 原样，替换 {name}", { name: 'x' })).toBe('留 {name} 原样，替换 x')
  })
})

describe('有宿主时', () => {
  it('注册到保留 ns，且只注册一次', () => {
    const registerI18n = vi.fn()
    const t = vi.fn(() => 'translated')
    setHost({ registerI18n, getPluginT: () => t })

    sdkT('resourceApi.error.network')
    sdkT('resourceApi.error.unauthorized')

    expect(registerI18n).toHaveBeenCalledTimes(1)
    expect(registerI18n.mock.calls[0][0]).toBe(SDK_I18N_NS)
    expect(Object.keys(registerI18n.mock.calls[0][1])).toEqual(['zh-CN', 'en-US'])
  })

  it('取词走宿主，不走回落', () => {
    const t = vi.fn(() => 'All clusters')
    setHost({ registerI18n: vi.fn(), getPluginT: () => t })

    expect(sdkT('resourceApi.error.network')).toBe('All clusters')
    expect(t).toHaveBeenCalledWith('resourceApi.error.network', undefined)
  })

  it('useSdkT 订阅语言变化', () => {
    const useLocale = vi.fn(() => 'en-US')
    setHost({ registerI18n: vi.fn(), getPluginT: () => (k: string) => k, useLocale })

    useSdkT()

    expect(useLocale).toHaveBeenCalled()
  })

  it('宿主只挂了一半（没有 registerI18n）也不抛', () => {
    setHost({})
    expect(sdkT('resourceApi.error.unauthorized')).toBe('未授权，请重新登录。')
  })
})

describe('sdkKey', () => {
  /* spec §4.2 约束 4：模块级表只存 key，渲染时再取词；sdkKey 是恒等函数，只做标记。 */
  it('原样返回，不取词', () => {
    expect(sdkKey('workspaceSelect.all')).toBe('workspaceSelect.all')
  })
})
