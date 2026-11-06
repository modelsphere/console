// @modelsphere/plugin-sdk — Core implementation (Story 10-2)

import type {
  PluginDefinition,
  PluginInstance,
  ApiClient,
  PluginEventMap,
  PluginEvents,
  PluginNav,
  PluginContext,
  RiseHostSDK,
  Scope,
  ScopeType,
} from './types'
import { SCOPE_TYPES } from './types'
import { getHostSDK } from './host'

/** SDK protocol version. The host exposes VERSION for compatibility checking.
 *  1.0.0（freeland#110）：对外发包起点，与宿主 __RISE_SDK__.VERSION 构成两端契约。
 *  1.0.1（theriseunion/project#67）：桥接路径与宿主事件总线对齐，并对齐真实作用域
 *  getScope 契约与 ScopeType 词汇。 */
const SDK_VERSION = '1.0.1'

// ── Helpers ─────────────────────────────────────────────────

/**
 * SDK 版本契约（freeland#110 能力 4）：major 不合 = 契约不兼容，拒载并报明原因，
 * 不再是仅告警 —— 半坏状态（菜单在、组件行为错）比不加载更难排查。
 * SDK 1.0 要求宿主 VERSION >= 1.0.0 且 major = 1；0.1.0 等旧宿主会直接拒载。
 * 宿主未声明 VERSION（旧宿主）时跳过，保持向后兼容。
 */
function checkVersion(sdk: RiseHostSDK): void {
  const hostVersion = sdk.VERSION
  if (!hostVersion) return // host hasn't declared a version yet — fail open
  // Strip a leading 'v' (e.g. 'v0.1.0', 'v0.1.0-beta') so it never parses to NaN.
  const normalized = hostVersion.replace(/^v/i, '')
  const [hostMajor] = normalized.split('.').map(Number)
  const [sdkMajor] = SDK_VERSION.split('.').map(Number)
  if (!Number.isFinite(hostMajor)) {
    console.warn(`[modelsphere-plugin-sdk] 宿主 VERSION 不可解析（${hostVersion}），跳过兼容校验。`)
    return
  }
  if (hostMajor !== sdkMajor) {
    throw new Error(
      `[modelsphere-plugin-sdk] Version mismatch: host ${hostVersion}, SDK ${SDK_VERSION}. ` +
      '请用与宿主同 major 的 @modelsphere/plugin-sdk 重新构建该插件。'
    )
  }
}

/*
  注册契约的校验诊断 —— **不国际化**（国际化规范 §1：开发者日志、调试文本和内部诊断
  不是默认的用户文案）。它抛给插件开发者看，只出现在构建期与浏览器控制台，不进界面；
  分类同 rise-global `2026-09-26-design-system-i18n-design.md` §4.4 豁免 1「开发期诊断」。
  本文件其余 `'必须是字符串'` 之类的 reason 同理。
*/
function validationError(pluginName: string, path: string, reason: string): never {
  throw new Error(`[modelsphere-plugin-sdk] plugin '${pluginName}': ${path} ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateRequiredString(pluginName: string, path: string, value: unknown): void {
  if (value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')) {
    validationError(pluginName, path, '缺失')
  }
  if (typeof value !== 'string') validationError(pluginName, path, '必须是字符串')
}

function validateOptionalString(pluginName: string, path: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'string') {
    validationError(pluginName, path, '必须是字符串')
  }
}

function validateMenu(pluginName: string, path: string, menu: unknown): void {
  if (!isRecord(menu)) validationError(pluginName, path, '必须是对象')

  validateRequiredString(pluginName, `${path}.name`, menu.name)
  validateRequiredString(pluginName, `${path}.path`, menu.path)
  validateRequiredString(pluginName, `${path}.scope`, menu.scope)

  for (const field of ['title', 'icon', 'parent', 'group', 'authKey'] as const) {
    validateOptionalString(pluginName, `${path}.${field}`, menu[field])
  }

  if (menu.order !== undefined && (typeof menu.order !== 'number' || !Number.isFinite(menu.order))) {
    validationError(pluginName, `${path}.order`, '必须是有限数字')
  }
  if (menu.hidden !== undefined && typeof menu.hidden !== 'boolean') {
    validationError(pluginName, `${path}.hidden`, '必须是布尔值')
  }
  if (menu.requiredScope !== undefined) {
    const validScopes: Scope['type'][] = [...SCOPE_TYPES]
    if (
      !Array.isArray(menu.requiredScope) ||
      menu.requiredScope.some((scope) => !validScopes.includes(scope as Scope['type']))
    ) {
      validationError(pluginName, `${path}.requiredScope`, '包含无效的 scope')
    }
  }
  if (menu.children !== undefined) {
    if (!Array.isArray(menu.children)) validationError(pluginName, `${path}.children`, '必须是数组')
    menu.children.forEach((child, index) => validateMenu(pluginName, `${path}.children[${index}]`, child))
  }
}

function validatePluginDefinition(def: unknown): void {
  const pluginName = (isRecord(def) && typeof def.name === 'string' && def.name.trim() !== '')
    ? def.name
    : '<plugin>'
  if (!isRecord(def)) validationError(pluginName, 'definition', '必须是对象')
  validateRequiredString(pluginName, 'name', def.name)

  if (def.menus !== undefined) {
    if (!Array.isArray(def.menus)) validationError(pluginName, 'menus', '必须是数组')
    def.menus.forEach((menu, index) => validateMenu(pluginName, `menus[${index}]`, menu))
  }

  if (def.scopes !== undefined) {
    if (!Array.isArray(def.scopes)) validationError(pluginName, 'scopes', '必须是数组')
    def.scopes.forEach((scope, index) => {
      const path = `scopes[${index}]`
      if (!isRecord(scope)) validationError(pluginName, path, '必须是对象')
      validateRequiredString(pluginName, `${path}.scope`, scope.scope)
      for (const field of ['title', 'icon', 'category'] as const) {
        validateOptionalString(pluginName, `${path}.${field}`, scope[field])
      }
    })
  }
}

// ── Runtime capabilities ────────────────────────────────────

function notImplemented(module: string, method: string): never {
  throw new Error(
    `[modelsphere-plugin-sdk] ${module}.${method}() is not yet implemented (Phase 0). ` +
    `This will be available in Phase 1.`
  )
}

function createStubAPI(): ApiClient {
  return {
    get: () => notImplemented('api', 'get'),
    post: () => notImplemented('api', 'post'),
    patch: () => notImplemented('api', 'patch'),
    delete: () => notImplemented('api', 'delete'),
  }
}

type EventName = keyof PluginEventMap
type StoredEventHandler = (data: unknown) => unknown

/**
 * State-like events keep a lastEmit snapshot that is replayed to new
 * subscribers. Reserved future events are deliberately excluded until their
 * payloads are finalised (T2/T3).
 */
const SNAPSHOT_EVENTS: ReadonlySet<EventName> = new Set<EventName>(['scope:change'])

const eventHandlers = new Map<EventName, Set<StoredEventHandler>>()
const lastEmits = new Map<EventName, unknown>()

/**
 * Notify one subscriber with error isolation, returning the subscriber's
 * result (possibly a promise). Covers both synchronous throws (try/catch) and
 * rejected promises from async subscribers (attached .catch), so a broken
 * handler never interrupts the others and never surfaces as an unhandled
 * rejection — while the caller (e.g. the host bridge wrapper) can still
 * observe the returned value.
 */
function invokeEventHandler(event: EventName, handler: StoredEventHandler, data: unknown): unknown {
  try {
    const result = handler(data)
    if (isPromiseLike(result)) {
      Promise.resolve(result).catch((error) => {
        console.error(`[modelsphere-plugin-sdk] events handler error for '${event}':`, error)
      })
    }
    return result
  } catch (error) {
    console.error(`[modelsphere-plugin-sdk] events handler error for '${event}':`, error)
    return undefined
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Locate an optional host event bus (console side, T2). Bridging is
 * all-or-nothing: only when the host exposes on/once/emit together do SDK
 * events bridge to it, so a partial bus (e.g. only on) can never swallow
 * emits or subscriptions. Otherwise fall back to the in-SDK bus.
 */
function resolveHostBus(): RiseHostSDK | null {
  try {
    const sdk = getHostSDK()
    return typeof sdk.on === 'function' &&
      typeof sdk.once === 'function' &&
      typeof sdk.emit === 'function'
      ? sdk
      : null
  } catch {
    return null // no host available — use the internal bus
  }
}

const FALLBACK_SCOPE: Scope = {
  type: 'platform',
  value: 'global',
  full: 'platform/global',
}

function readHostScope(): Scope | null {
  try {
    const payload = getHostSDK().getScope?.()
    if (!isRecord(payload)) return null

    const type = payload.scope
    const value = payload.value
    const full = payload.full
    if (typeof type !== 'string' || !SCOPE_TYPES.includes(type as ScopeType)) return null
    if (typeof value !== 'string' || value.trim() === '') return null
    if (typeof full !== 'string' || full.trim() === '') return null
    if (full !== `${type}/${value}`) return null

    return { type: type as ScopeType, value, full }
  } catch {
    return null
  }
}

function getReplayPayload(event: EventName): { available: boolean; value?: unknown } {
  if (!SNAPSHOT_EVENTS.has(event)) return { available: false }
  if (lastEmits.has(event)) return { available: true, value: lastEmits.get(event) }

  // The only current snapshot event is scope:change. If another event is
  // added to SNAPSHOT_EVENTS, confirm its replay payload shape here as well.
  const scope = readHostScope()
  if (scope) {
    return {
      available: true,
      value: { scope: scope.type, value: scope.value, full: scope.full },
    }
  }
  return { available: false }
}

function subscribeEvent<Event extends EventName>(
  pluginName: string,
  event: Event,
  handler: (data: PluginEventMap[Event]) => void,
  once: boolean,
): () => void {
  const replay = getReplayPayload(event)

  const bus = resolveHostBus()
  if (bus) {
    if (replay.available) {
      invokeEventHandler(event, handler as StoredEventHandler, replay.value)
      if (once) return () => {} // snapshot consumed the once subscription
    }

    const hostFn = once ? bus.once : bus.on
    if (hostFn) {
      const wrapped: StoredEventHandler = (data) => {
        if (SNAPSHOT_EVENTS.has(event)) lastEmits.set(event, data)
        return invokeEventHandler(event, handler as StoredEventHandler, data)
      }
      const unsubscribe = hostFn.call(bus, event, wrapped, pluginName)
      return typeof unsubscribe === 'function' ? unsubscribe : () => {}
    }
  }

  let handlers = eventHandlers.get(event)
  if (!handlers) {
    handlers = new Set()
    eventHandlers.set(event, handlers)
  }

  const storedHandler: StoredEventHandler = (data) => {
    if (once) unsubscribe()
    return handler(data as PluginEventMap[Event])
  }
  const unsubscribe = (): void => {
    handlers.delete(storedHandler)
    if (handlers.size === 0) eventHandlers.delete(event)
  }

  handlers.add(storedHandler)
  if (replay.available) {
    invokeEventHandler(event, storedHandler, replay.value)
  }
  return unsubscribe
}

function createEvents(pluginName: string): PluginEvents {
  return {
    emit<Event extends EventName>(event: Event, data: PluginEventMap[Event]): void {
      // Record the snapshot locally (state-like events only) in every mode so
      // replay is SDK-guaranteed and independent of the host implementation.
      if (SNAPSHOT_EVENTS.has(event)) lastEmits.set(event, data)

      const bus = resolveHostBus()
      if (bus && typeof bus.emit === 'function') {
        bus.emit.call(bus, event, data)
        return
      }

      const handlers = eventHandlers.get(event)
      if (!handlers) return
      for (const handler of [...handlers]) invokeEventHandler(event, handler, data)
    },
    on: (event, handler) => subscribeEvent(pluginName, event, handler, false),
    once: (event, handler) => subscribeEvent(pluginName, event, handler, true),
  }
}

function createStubNav(): PluginNav {
  return {
    addMenu: () => notImplemented('nav', 'addMenu'),
    removeMenu: () => notImplemented('nav', 'removeMenu'),
    setBadge: () => notImplemented('nav', 'setBadge'),
  }
}

function createPluginContext(def: PluginDefinition): PluginContext {
  const scope = readHostScope() ?? FALLBACK_SCOPE
  return {
    plugin: { name: def.name, version: def.version, trust: 'verified' },
    scope,
    tenant: { id: '', name: '', displayName: '' },
    user: { id: '', name: '', roles: [] },
    activeScope: 'console',
    locale: 'zh-CN',
    theme: { mode: 'light', primaryColor: '#3B82F6', cssVariables: {} },
    hasPermission: () => true,
  }
}

// ── createPlugin ────────────────────────────────────────────

/**
 * Create and register a Rise plugin.
 *
 * This is the single entry point for plugin development.  It handles:
 * - Menu registration
 * - Component registration
 * - Slot registration
 * - Lifecycle hooks (onMount / onScopeChange / onUnmount)
 *
 * @example
 * ```ts
 * import { createPlugin } from '@modelsphere/plugin-sdk'
 *
 * const plugin = createPlugin({
 *   name: 'hello-world',
 *   version: '1.0.0',
 *   displayName: 'Hello World',
 *   menus: [
 *     { name: 'dashboard', title: 'Hello', path: '/rise.io/v1/hello-world/dashboard',
 *       scope: 'console', icon: 'smile', order: 500 },
 *   ],
 *   components: { HelloWorldDashboard },
 * })
 * ```
 */
function registerComponentsAndSlots(sdk: RiseHostSDK, def: PluginDefinition): void {
  // ── Register components ──
  if (def.components) {
    for (const [componentName, component] of Object.entries(def.components)) {
      sdk.registerPluginComponent(def.name, componentName, component)
    }
  }

  // ── Register slots ──
  if (def.slots) {
    for (const slot of def.slots) {
      sdk.registerSlot({
        type: slot.type,
        name: slot.name,
        plugin: def.name,
        target: slot.target,
        order: slot.order ?? 999,
      })
    }
  }

}

function registerDefinition(sdk: RiseHostSDK, def: PluginDefinition): void {
  const bridgedMenus = (def.menus || []).map((m) => ({
    name: m.name,
    title: m.title,
    path: m.path,
    icon: m.icon || '',
    scope: m.scope,
    parent: m.parent,
    group: m.group || '',
    order: m.order ?? 999,
    authKey: m.authKey || '',
    hidden: m.hidden || false,
    children: m.children || [],
  }))

  sdk.registerPlugin({
    name: def.name,
    version: def.version,
    displayName: def.displayName,
    icon: def.icon || '',
    scope: '', // plugin-level scope left empty for child plugins
    scopes: def.scopes || undefined,
    menus: bridgedMenus,
  })

}

export function createPlugin(def: PluginDefinition): PluginInstance {
  validatePluginDefinition(def)
  const sdk = getHostSDK()
  checkVersion(sdk)

  registerDefinition(sdk, def)

  registerComponentsAndSlots(sdk, def)

  if (def.routes && Object.keys(def.routes).length > 0) {
    sdk.registerPluginRoutes(def.name, def.routes as Record<string, any>)
  }

  if (def.onMount) {
    const ctx = createPluginContext(def)
    try {
      def.onMount(ctx)
    } catch (err) {
      console.error(`[modelsphere-plugin-sdk] ${def.name} onMount error:`, err)
    }
  }

  console.log(`[modelsphere-plugin-sdk] Plugin created: ${def.name} v${def.version}`)

  return {
    name: def.name,
    api: sdk.apiClient || createStubAPI(),
    events: createEvents(def.name),
    nav: createStubNav(),
  }
}
