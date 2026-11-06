import { readHostSDK } from "./host-global";
// SDK 自己的文案通道。
//
// ── 为什么 SDK 需要一条自己的通道 ────────────────────────────────────────────
// 业务组件（SpecSelect / ImageSelect / 三个作用域选择器…）住在这个包里，不属于任何插件，
// 拿不到插件的 namespace。之前的做法是把中文写死在组件里 —— `packages/**` 不在写死中文
// 棘轮的扫描面，所以一直没被拦住，英文界面下原样显示中文。
//
// 做法照 `@theriseunion/ui`：词表随包走，注册到一个保留 ns，取词经宿主同一个 i18next 实例
// （宿主侧对应的是 `console/src/i18n/engine.ts` 末尾的 `registerI18n('ui', uiLocales)`）。
// 区别是本包被打进每个插件的产物、不由宿主加载，所以注册由本包自己做，宿主零改动。
//
// ── 注册是幂等的 ────────────────────────────────────────────────────────────
// 每个插件的产物里都有一份本模块，各自注册一次。宿主的 `registerI18n` 落到
// `addResourceBundle(lng, ns, res, /*deep*/true, /*overwrite*/true)`，重复注册同一份是合并，
// 无副作用。
//
// ── 没有宿主时不能抛 ────────────────────────────────────────────────────────
// 单测与 SSR 里 `window.__RISE_SDK__` 不存在。那时回落到中文词表 + 最小插值，行为与
// design 的 `i18n/store.ts` 未注入适配器时一致：能渲染出中文，不抛。

import zhCN from './locales/sdk.zh-CN'
import enUS from './locales/sdk.en-US'

/** 本包在宿主 i18next 里的保留 namespace。 */
export const SDK_I18N_NS = 'rise-sdk'

export type SdkTranslate = (key: string, params?: Record<string, unknown>) => string

/**
 * 模块级表里的 key 用它标记。恒等函数，只为读代码时一眼看出「这是 key、不是文案」。
 *
 * 取词**不得在模块顶层求值** —— 那时语言还没定，值会被永久钉在 zh-CN。
 * 模块级表只存 key，渲染时再用 `t` 解析（spec §4.2 约束 4）：
 *
 *   const QUOTA_SCOPE = { project: sdkKey('specSelect.quota.project') }   // ✅
 *   const QUOTA_SCOPE = { project: sdkT('specSelect.quota.project') }     // ❌ 顶层求值
 */
export function sdkKey<K extends string>(key: K): K {
  return key
}

type HostLike = {
  registerI18n?: (ns: string, res: Record<string, Record<string, unknown>>) => void
  getPluginT?: (ns: string) => SdkTranslate
  useLocale?: () => string
  React?: { useMemo: <T>(factory: () => T, deps: unknown[]) => T }
}

function host(): HostLike | null {
  return (readHostSDK() as HostLike | undefined) ?? null
}

let registered = false

/**
 * 把本包的词表注册进宿主。首次取词时调用，不在模块顶层执行 —— 插件产物加载时宿主 SDK
 * 可能还没挂上（`host.ts` 的注释：读宿主一律在调用时，不在 import 时）。
 */
export function ensureSdkI18nRegistered(): void {
  if (registered) return
  const h = host()
  if (!h?.registerI18n) return
  h.registerI18n(SDK_I18N_NS, { 'zh-CN': zhCN as unknown as Record<string, unknown>, 'en-US': enUS as unknown as Record<string, unknown> })
  registered = true
}

/**
 * 仅供单测：按中文词表解析一个 key。装了假宿主的组件测试拿它当 `getPluginT` 的实现，
 * 于是那些断言验的是真词表渲染出来的中文，不是 key 原文（design spec §8.2 第 1 项）。
 */
export function sdkFallbackT(key: string, params?: Record<string, unknown>): string {
  return renderFallback(readFallback(key) ?? key, params)
}

/** 仅供单测：清掉「已注册」标记。 */
export function resetSdkI18nForTest(): void {
  registered = false
}

function readFallback(key: string): string | undefined {
  let node: unknown = zhCN
  for (const seg of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[seg]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * 未注入宿主时的最小渲染，做两件事（与 design 的 `i18n/store.ts` 同口径，
 * 见 rise-global spec `2026-09-26-design-system-i18n-design.md` §4.2 约束 3）：
 *
 *   1. 按 `{name}` 替换插值；
 *   2. 按 ICU 规则还原引号转义 —— `''` → `'`，`'{…}'` → `{…}`。
 *
 * 不做第 2 件的话，中文界面在无宿主路径（单测 / SSR）下会把转义符原样印出来。
 * 复数与 select 交给宿主的 ICU，本函数不处理。
 */
export function renderFallback(text: string, params?: Record<string, unknown>): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "'") {
      // '' → 一个字面撇号
      if (text[i + 1] === "'") { out += "'"; i += 2; continue }
      // '{…}' → 花括号原样输出，且**不参与插值**（先还原再插值会把它也替换掉）
      const close = text.indexOf("'", i + 1)
      if (close > i && /[{}]/.test(text.slice(i + 1, close))) {
        out += text.slice(i + 1, close)
        i = close + 1
        continue
      }
      out += c
      i += 1
      continue
    }
    if (c === '{' && params) {
      const close = text.indexOf('}', i)
      const name = close > i ? text.slice(i + 1, close) : ''
      if (close > i && /^\w+$/.test(name)) {
        out += Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : text.slice(i, close + 1)
        i = close + 1
        continue
      }
    }
    out += c
    i += 1
  }
  return out
}

/**
 * 取词函数。宿主在就走宿主的 i18next（跟随当前语言、走 ICU）；不在就回落中文词表。
 *
 * 非组件代码（校验、纯函数）直接调它；组件里用 `useSdkT()`，那个会订阅语言变化。
 */
export function sdkT(key: string, params?: Record<string, unknown>): string {
  ensureSdkI18nRegistered()
  const h = host()
  if (h?.getPluginT) return h.getPluginT(SDK_I18N_NS)(key, params)
  return renderFallback(readFallback(key) ?? key, params)
}

/**
 * 组件里的取词 hook：订阅语言变化，切语言即重渲染。
 *
 * 返回的函数身份跟着语言走（宿主 `getPluginT` 按 `${locale}:${ns}` 缓存），所以放进
 * `useMemo` / `useCallback` 的依赖里是安全的 —— 这正是宿主那层缓存存在的原因。
 */
export function useSdkT(): SdkTranslate {
  const h = host()
  // 订阅语言：没有宿主（单测 / SSR）时跳过，回落路径不需要重渲染。
  h?.useLocale?.()
  ensureSdkI18nRegistered()
  if (h?.getPluginT) return h.getPluginT(SDK_I18N_NS)
  return sdkT
}
