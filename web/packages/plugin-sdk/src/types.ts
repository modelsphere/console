// ============================================================
// @modelsphere/plugin-sdk — TypeScript Type Definitions
// Design doc: _bmad-output/design-plugin-sdk-api.md
// ============================================================

// ── Scope (Resource Scope) ──────────────────────────────────

/**
 * Resource scope type in Rise Global's hierarchical permission model.
 * The host uses `project` for project URLs; `namespace` is retained as a
 * legacy alias for compatibility with existing plugins.
 */
export const SCOPE_TYPES = [
  'platform',
  'cluster',
  'workspace',
  'project',
  'namespace',
  'nodegroup',
] as const

export type ScopeType = (typeof SCOPE_TYPES)[number]

/**
 * Scope represents the current page's resource boundary.
 *
 * Rise Global organises resources hierarchically:
 *   platform → cluster → nodegroup
 *                      → workspace → project
 *
 * The host resolves the Scope from the current URL automatically.
 * Plugins should use `scope` to decide API call boundaries,
 * permission checks, and UI data granularity.
 */
export interface Scope {
  /** Scope level */
  type: ScopeType
  /** Concrete identifier (cluster ID, workspace ID, etc.). 'global' at platform level. */
  value: string
  /** Full identifier: `{type}/{value}`, e.g. 'project/project-a' */
  full: string
}

// ── View Mode ────────────────────────────────────────────────

/**
 * View mode determines menu visibility. Matches backend menu scope values.
 * 'boss' = platform admin (infrastructure management)
 * 'console' = tenant user (business operations)
 */
export type ViewMode = 'boss' | 'console'

/** 菜单的资源上下文（决定 URL 前缀与侧边栏选择器），与 viewport(ViewMode) 是两个独立维度。
 *  历史上此字段曾误标为 ViewMode —— 宿主实际一直按资源上下文处理（见 rise-global CLAUDE.md
 *  「两个独立维度」），此类型是对既有行为的如实描述，非契约变更。 */
export type MenuScope = 'platform' | 'cluster' | 'nodegroup' | 'workspace' | 'project'

// ── Menu ────────────────────────────────────────────────────

/** A single menu item registered by a plugin. */
export interface PluginMenu {
  /** Unique identifier within the plugin */
  name: string
  /** Display text——**中文真源,应始终提供**(ADR-0011)。中文态直接渲染此值;
   *  英文态渲染时按 name 派生 {ns}:menu.{camelCase(name)} 查 locales/menu.en-US.json,
   *  查不到回落本字段。注册表不为 i18n 变形,英文是渲染层增量。 */
  title?: string
  /** Route path (relative to the parent module, e.g. '/dashboard') */
  path: string
  /** Lucide icon name, kebab-case (e.g. 'bar-chart-2') */
  icon?: string
  /** 资源上下文：决定 URL 前缀与侧边栏选择器（platform 无前缀 / cluster / workspace / project …） */
  scope: MenuScope
  /** Parent plugin name for sidebar injection (omit = own sidebar, set = inject into parent's sidebar) */
  parent?: string
  /** Sidebar group title——中文真源,同时是跨插件分组合并 key(多插件注入同一侧边栏须逐字一致)。
   *  英文态按值查 {ns}:group.{中文值},缺则回落原串(ADR-0011)。如 '算力服务' */
  group?: string
  /** Sort order (lower = higher). Default 999. */
  order?: number
  /** Permission key for RBAC filtering */
  authKey?: string
  /** Hidden from sidebar (path→component mapping only) */
  hidden?: boolean
  /** Limit menu visibility to specific resource scope levels */
  requiredScope?: ScopeType[]
  /** Nested child menu items */
  children?: PluginMenu[]
}

// ── Context ─────────────────────────────────────────────────

/** Runtime context injected into plugin lifecycle hooks. */
export interface PluginContext {
  /** Current plugin metadata */
  plugin: {
    name: string
    version: string
    /** Trust level derived from frontend.type + runtime */
    trust: 'trusted' | 'verified' | 'sandboxed'
  }

  /** Current resource scope (auto-resolved from URL by host) */
  scope: Scope

  /** Current tenant */
  tenant: {
    id: string
    name: string
    displayName: string
  }

  /** Current user */
  user: {
    id: string
    name: string
    roles: string[]
  }

  /** Current view mode: boss (admin) or console (tenant) */
  activeScope: ViewMode

  /** Current locale(onMount 时的一次性快照;响应式请用 SDK.useLocale(),勿静态读此值) */
  locale: string

  /** Theme variables */
  theme: {
    mode: 'light' | 'dark'
    primaryColor: string
    cssVariables: Record<string, string>
  }

  /**
   * Check if the current user has a permission in the current scope.
   * Format: '{scopeType}/{resource}.{action}', e.g. 'project/pod.view'
   */
  hasPermission: (permission: string) => boolean
}

// ── Sub-module interfaces (Phase 0: stubs) ──────────────────

/** HTTP proxy — auto-injects auth token and tenant header. */
export interface PluginAPI {
  get<T = unknown>(path: string, opts?: RequestOpts): Promise<T>
  post<T = unknown>(path: string, opts?: RequestOpts): Promise<T>
  put<T = unknown>(path: string, opts?: RequestOpts): Promise<T>
  delete<T = unknown>(path: string, opts?: RequestOpts): Promise<T>
}

export interface RequestOpts {
  body?: unknown
  params?: Record<string, string>
  headers?: Record<string, string>
  /** Override the auto-resolved scope for this request */
  scopeOverride?: Pick<Scope, 'type' | 'value'>
  /** Skip scope injection entirely */
  noScope?: boolean
}

/** Typed events shared by the host and plugins. */
export interface PluginEventMap {
  'scope:change': { scope: ScopeType; value: string; full: string }
  'plugin:enabled': unknown
  'plugin:disabled': unknown
  'resource:change': unknown
  'nav:change': unknown
}

/** Cross-plugin event bus (pub/sub). */
export interface PluginEvents {
  /** Publish an event. */
  emit<Event extends keyof PluginEventMap>(event: Event, data: PluginEventMap[Event]): void
  /** Subscribe. Returns an unsubscribe function. */
  on<Event extends keyof PluginEventMap>(
    event: Event,
    handler: (data: PluginEventMap[Event]) => void,
  ): () => void
  /** Subscribe once. */
  once<Event extends keyof PluginEventMap>(
    event: Event,
    handler: (data: PluginEventMap[Event]) => void,
  ): () => void
}

/** Dynamic navigation operations. */
export interface PluginNav {
  addMenu(menu: PluginMenu): void
  removeMenu(name: string): void
  setBadge(menuName: string, badge: { count: number; type?: 'info' | 'warning' | 'error' }): void
}

// ── Slot ────────────────────────────────────────────────────

/** Slot injection into host-defined extension points. */
export interface SlotRegistration {
  /** Slot type: where to inject */
  type:
    | 'dashboard-widget'
    | 'detail-tab'
    | 'toolbar-action'
    | 'page-header'
    | 'test-widget'
    | 'project-overview-widget'
  /** Unique slot name within the plugin */
  name: string
  /** Registered component name to render */
  target: string
  /** Sort order */
  order?: number
}

// ── Scope Declaration (Dock metadata) ────────────────────────

/** Declares a Dock entry for a specific scope. */
export interface ScopeDeclaration {
  /** Resource scope: 'platform' | 'cluster' | 'workspace' | 'project' */
  scope: string
  /** UI 模式：'boss'（管理）| 'console'（租户）。决定顶栏样式与 Dock 过滤（与 scope 是两个独立维度）。
   *  宿主侧 ScopeDeclaration 一直有此字段（ModuleNavContext），SDK 类型此前漏了 —— 补齐既有契约，非新增语义。 */
  viewport?: 'boss' | 'console'
  /** Dock entry title——**中文真源,应始终提供**(ADR-0011);英文态查 {ns}:scope.{scope},缺则回落此值。 */
  title?: string
  /** Lucide icon name, kebab-case */
  icon?: string
  /** Dock group category. Omit for the default group.
   *  分类译文由 host 侧 catLabel 统一映射(dock 分组是 host 聚合,非单插件所有),插件无需声明分类 i18n key。 */
  category?: string
  /** Dock 点击落地路径（覆盖默认的“第一个菜单”；无侧边栏的插件用它） */
  path?: string
}

// ── Plugin Definition (createPlugin input) ──────────────────

/** Input to `createPlugin()`. */
export interface PluginDefinition {
  /** Plugin identifier (must match plugin.yaml name) */
  name: string
  /** Semantic version */
  version: string
  /** Human-readable display name */
  displayName: string
  /** Lucide icon name for dock entry */
  icon?: string

  /**
   * Dock entry declarations per scope.
   * Each entry = one Dock button. Menus with matching scope are shown in that sidebar.
   * Omit for contributed-only plugins (all menus have parent).
   */
  scopes?: ScopeDeclaration[]

  /** Menu items to register */
  menus?: PluginMenu[]

  /**
   * React components to register. Keys are component names,
   * values are React component functions/classes.
   * Registered as `{pluginName}/{componentName}` in the host.
   */
  components?: Record<string, unknown>

  /** Slot injections */
  slots?: SlotRegistration[]

  /**
   * Dynamic route patterns for sub-pages (e.g. detail views).
   * Keys are Next.js-style patterns: 'containers/[name]/details'
   * Values are React component functions.
   */
  routes?: Record<string, unknown>

  // ── Lifecycle hooks ──

  /** Called after plugin is registered. Receives runtime context. */
  onMount?: (ctx: PluginContext) => void
  /** Called when the resource scope changes (user switches project/workspace). */
  onScopeChange?: (newScope: Scope, oldScope: Scope) => void
  /** Called when the plugin is deactivated. Clean up resources here. */
  onUnmount?: () => void
}

// ── Plugin Instance (createPlugin return) ───────────────────

/** Returned by `createPlugin()`. Provides runtime SDK capabilities. */
export interface PluginInstance {
  /** Plugin name */
  readonly name: string
  /** Pre-configured API client (auth + 401 handling) */
  readonly api: ApiClient
  /** Typed cross-plugin event bus */
  readonly events: PluginEvents
  /** Dynamic navigation (Phase 1) */
  readonly nav: PluginNav
}

// ── Host API Client ────────────────────────────────────────

/** Response wrapper returned by host apiClient methods. */
export interface ApiResponse<T = unknown> {
  data: T
  status: number
}

/** Pre-configured HTTP client provided by the host. Handles auth (cookie) and 401 redirect. */
export interface ApiClient {
  get<T = unknown>(url: string, options?: { params?: Record<string, any> }): Promise<ApiResponse<T>>
  post<T = unknown>(url: string, data?: unknown): Promise<ApiResponse<T>>
  patch<T = unknown>(url: string, data?: unknown): Promise<ApiResponse<T>>
  delete<T = unknown>(url: string): Promise<ApiResponse<T>>
}

// ── Scope Context ─────────────────────────────────────────

/** Runtime scope context reflecting current URL state. Updated by host on navigation. */
export interface ScopeContextValue {
  scope: string
  cluster: string
  workspace: string
  project: string
}

// ── 宿主注入面 ───────────────────────────────────────────

/**
 * 宿主注入面 `window.__RISE_SDK__.ui`：`@theriseunion/ui` 的全部运行时导出。
 *
 * 本包会发布到 npm registry，`.d.ts` 不能引用消费方装不到的 `@theriseunion/ui`，所以这里只是 `Record<string, any>` 占位。
 * 精确类型由插件侧提供（需同级 clone rise-global 并 extends 仓库根 `tsconfig.base.json`）：
 *
 * ```ts
 * // src/lib/ui.ts
 * import type * as UI from '@theriseunion/ui'
 * export const ui = getUi<typeof UI>()
 * ```
 */
export type UiSurface = Record<string, any>

/** 宿主注入面 `window.__RISE_SDK__.business`：`@theriseunion/business` 的全部运行时导出。精确类型同 {@link UiSurface}，用 `getBusiness<typeof Business>()`。 */
export type BusinessSurface = Record<string, any>

/** 宿主权限判定（`usePermissions()` 的返回值）。权限异步拉取，加载期 `hasPermission` 返回 false，到达后自动重渲染。 */
export interface PermissionsAPI {
  /** 当前 scope 下是否拥有该权限 key */
  hasPermission: (permission: string) => boolean
  /** 权限是否仍在加载 */
  loading: boolean
  [key: string]: unknown
}

// ── Auth API (SDK namespace: 'auth') ────────────────────────

/** Current user information. */
export interface AuthUser {
  username: string
  email?: string
  role?: string
}

/** Auth namespace — access via `sdk.get('auth')` or `getAuth()`. */
export interface AuthAPI {
  getUser(): AuthUser
  hasPermission(key: string): boolean  // Phase 1: always returns true, reserved for RBAC
}

// ── Page Scope Filter Hook ─────────────────────────────────

export type ScopeFilterKind = 'cluster' | 'workspace'

export interface ScopeFilterOption {
  name: string
  displayName?: string
}

export interface UseScopeFilterOptions {
  /** Plugin.metadata.name. Cluster candidates come only from the Tenant plugin clusters API. */
  pluginName?: string
  defaultValue?: string
  /** false 时不取列表，value 恒为默认值。供同时服务 console 与 boss 的公共 hook 按形态关闭。 */
  enabled?: boolean
  /**
   * 把选中值同步到 URL query，默认关闭。`true` 时参数名取 kind（`cluster` / `workspace`），
   * `{ param }` 指定参数名。
   * - 初值：URL 有该参数则优先于 defaultValue（`?p=` 即空串，对应「全部」）；无参数用 defaultValue。
   * - setValue：用 replaceState 写参数，保留 pathname、hash 与其它参数；等于 defaultValue 时移除参数。
   * - 监听 popstate 重读；列表加载后值无效则回落 defaultValue 并移除参数。
   * - enabled=false 时不读写 URL；不使用 localStorage / sessionStorage。
   */
  syncUrl?: boolean | { param?: string }
}

export interface UseScopeFilterResult {
  /** Empty string means all workspaces; cluster pages default to "host". */
  value: string
  setValue: (v: string) => void
  options: ScopeFilterOption[]
  loading: boolean
  /**
   * 最近一次取候选列表失败的原因；加载中、成功或 enabled=false 时为 null。失败时 options 为空，
   * 调用方靠它区分「列表加载失败」与「列表加载成功但为空」。忽略该字段的调用方行为不变。
   */
  error?: unknown | null
  /** 重新取候选列表：立即清掉 error 并进入 loading；enabled=false 时无效。 */
  retry?: () => void
}

// ── Host SDK interface (window.__RISE_SDK__) ────────────────

/**
 * The raw host SDK exposed on `window.__RISE_SDK__`.
 * Plugin developers should NOT use this directly — use typed accessors instead.
 * This type is exported for internal/testing use only.
 */
export interface RiseHostSDK {
  React: unknown
  ReactJSXRuntime?: unknown
  ReactJSXDevRuntime?: unknown
  VERSION?: string
  registerPlugin: (def: unknown) => void
  registerPluginComponent: (pluginName: string, componentName: string, component: unknown) => void
  /** Lookup every component the given plugin has registered. Added in Story 7.4. */
  getPluginComponents?: (pluginName: string) => Record<string, unknown>
  registerPluginRoutes: (pluginName: string, routes: Record<string, unknown>) => void
  registerSlot: (def: unknown) => void
  createPlugin: (def: unknown) => unknown
  /**
   * Optional host event bus (console side, T2). When present, the SDK's
   * `events` bridge to it so plugin subscriptions connect to host broadcasts;
   * the SDK falls back to its in-bundle bus otherwise.
   */
  on?: (event: string, handler: (data: unknown) => void, pluginName?: string) => (() => void) | void
  once?: (event: string, handler: (data: unknown) => void, pluginName?: string) => (() => void) | void
  emit?: (event: string, data: unknown) => void
  /** Host current scope payload `{ scope, value, full }`, used by onMount and first-subscription replay. */
  getScope?: () => PluginEventMap['scope:change'] | null
  /** Pre-configured API client for HTTP requests. */
  apiClient: ApiClient
  /** Client-side navigation with auto scope prefix. */
  navigate: (url: string) => void
  /** 宿主注入面：`@theriseunion/ui` 的全部运行时导出。插件经 `getUi()` 取用。 */
  ui: UiSurface
  /** 宿主注入面：`@theriseunion/business` 的全部运行时导出。插件经 `getBusiness()` 取用。 */
  business: BusinessSurface
  /** 宿主能力：权限判定 hook（React hook，只能在组件内调用）。插件经本包导出的 `usePermissions()` 调用。 */
  usePermissions: () => PermissionsAPI
  /** Current scope context. Updated by host on navigation. */
  ScopeContext: ScopeContextValue
  /** Current scope level (e.g. 'project'). Updated by host when user switches project. */
  scope: string
  /** Current scope value (e.g. project/namespace ID). Updated by host when user switches project. */
  scopeValue: string
  /** Subscribe to scope changes. */
  onScopeChange: (fn: (scope: string, scopeValue: string) => void) => void
  /** Unsubscribe from scope changes. */
  offScopeChange: (fn: (scope: string, scopeValue: string) => void) => void
  /** Get a named SDK namespace (e.g. 'auth'). */
  get(name: 'auth'): AuthAPI
  get(name: string): unknown

  // ── i18n(引擎与 locale 状态在 host 一份;插件译文自带,经 registerI18n 注册)──
  /** 注册插件译文到自己的 namespace(通常 = 插件 name 段)。多次调用可 merge。 */
  registerI18n(ns: string, resources: Record<string, Record<string, unknown>>): void
  /** 返回绑定 namespace 的 t(跟随当前语言);显式 `common:` 前缀经 fallbackNS 仍解析。 */
  getPluginT(ns: string): (key: string, params?: Record<string, unknown>) => string
  /** 默认(common ns)t。 */
  t(key: string, params?: Record<string, unknown>): string
  /** 当前语言码(如 'zh-CN')。 */
  getLocale(): string
  /** 切语言 + 持久化 + <html lang>。 */
  setLocale(lng: string): void
  /** 订阅语言变化,返回反订阅函数。 */
  subscribeLocale(cb: () => void): () => void
  /** React hook:响应式读当前语言(切语言时组件重渲染)。插件 useT() 内部调用。 */
  useLocale(): string
  /** locale-aware 日期格式化。 */
  formatDate(ts: number | string | Date, opts?: Intl.DateTimeFormatOptions): string
  /** locale-aware 数字格式化。 */
  formatNumber(n: number, opts?: Intl.NumberFormatOptions): string
}
