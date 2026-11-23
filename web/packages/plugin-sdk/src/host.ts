import { readHostSDK } from "./host-global";
// @modelsphere/plugin-sdk — Typed accessors for host SDK capabilities
//
// These functions provide type-safe access to `window.__RISE_SDK__` properties.
// They read from the host at call time (not import time), so they work correctly
// even when the host populates the SDK asynchronously.

import type { RiseHostSDK, ApiClient, AuthAPI, BusinessSurface, PermissionsAPI, ScopeContextValue, UiSurface } from './types'

/** Get the raw host SDK. Throws if not running inside Rise Console. */
export function getHostSDK(): RiseHostSDK {
  const sdk = readHostSDK()
  if (!sdk) {
    throw new Error(
      '[modelsphere-plugin-sdk] window.__RISE_SDK__ not found. ' +
      'Is this running inside ModelSphere Console?'
    )
  }
  return sdk
}

/** Get the pre-configured API client. Handles auth (cookie) and 401 redirect. */
export function getApi(): ApiClient {
  return getHostSDK().apiClient
}

/** Client-side navigation with auto scope prefix. */
export function navigate(url: string): void {
  getHostSDK().navigate(url)
}

/** 宿主未就绪（单测、SSR、宿主外加载）时返回空对象：插件在模块顶层建句柄，导入阶段不能抛错。 */
function hostSurface(name: 'ui' | 'business'): Record<string, unknown> {
  return (readHostSDK()?.[name] ?? {}) as Record<string, unknown>
}

/**
 * 取宿主注入面 `window.__RISE_SDK__.ui`（`@theriseunion/ui`）。插件只在 `src/lib/ui.ts` 调一次：
 *
 * ```ts
 * import type * as UI from '@theriseunion/ui'
 * export const ui = getUi<typeof UI>()
 * ```
 *
 * 类型参数在编译期擦除，产物不变；不传时为 `any`（没有同级 clone rise-global 的独立插件仓）。
 * 宿主在加载插件 UMD 之前已挂好注入面，模块顶层调用是安全的。
 */
export function getUi<T = UiSurface>(): T {
  return hostSurface('ui') as T
}

/**
 * 取宿主注入面 `window.__RISE_SDK__.business`（`@theriseunion/business`）。插件只在 `src/lib/business.ts` 调一次：
 *
 * ```ts
 * import type * as Business from '@theriseunion/business'
 * export const business = getBusiness<typeof Business>()
 * ```
 */
export function getBusiness<T = BusinessSurface>(): T {
  return hostSurface('business') as T
}

/**
 * 宿主权限判定 hook（React hook，只能在组件内调用）。转发宿主 `PermissionContext`，权限到达自动重渲染；
 * 判权用它，不要用 `getAuth().hasPermission`（命令式读取拿不到「权限到了」的信号）。
 */
export function usePermissions(): PermissionsAPI {
  const hook = readHostSDK()?.usePermissions
  if (typeof hook !== 'function') {
    throw new Error('[modelsphere-plugin-sdk] usePermissions is not provided by the host. Requires a Rise console with SDK.ui / SDK.business (rise-global#1317 or later).')
  }
  return hook() as PermissionsAPI
}

/** Get current scope context (scope, cluster, workspace, project). */
export function getScopeContext(): ScopeContextValue {
  return getHostSDK().ScopeContext
}

/** Get the auth namespace. Provides current user info and permission checks. */
export function getAuth(): AuthAPI {
  return getHostSDK().get('auth')
}

/**
 * Get every component a plugin has registered, keyed by component name.
 * Used by business plugins to embed shared SDK widgets (Story 7.4 —
 * compute-core exposes QuotaPreflight this way). Returns an empty bag if
 * the plugin isn't loaded yet — callers should re-read the bag inside a
 * useEffect, not at module top level.
 */
export function getPluginComponents<T extends Record<string, unknown> = Record<string, unknown>>(
  pluginName: string,
): T {
  const fn = getHostSDK().getPluginComponents
  if (typeof fn !== 'function') return {} as T
  return fn(pluginName) as T
}

/**
 * Generate a UUID v4.
 * crypto.randomUUID() requires a Secure Context (HTTPS).
 * This function falls back to crypto.getRandomValues() which works on HTTP.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback using crypto.getRandomValues (available in all browsers, including HTTP)
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
