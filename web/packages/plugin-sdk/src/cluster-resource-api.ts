// Cluster-scoped request helper for platform API paths (ADR 0029, URL scope 与授权).
// scopedApi is path-agnostic: any /oapis/, /api/ or /apis/ relative path is
// accepted. What the /clusters/{cluster} prefix means differs per API family
// (see the README table 三类 API 的行为差异), so callers must know the
// semantics of the API they address. The SDK only guarantees wire mechanics:
// it refuses absolute URLs, dot segments, encoded separators, control
// characters and a pre-prefixed /clusters/ path, and it encodes the cluster
// name exactly once.

import { sdkT } from './i18n'

export const RESOURCES_FACADE_PREFIX = '/oapis/resources.theriseunion.io/v1alpha1/'

/** Authorization axis (ADR 0029):
 *  consumption = 用户侧，裸路径按 Namespace/Workspace 权限；
 *  cluster = 管理侧，显式 /clusters/{cluster} 按 Cluster 权限。
 *  This is the request's scope, not the plugin viewport or user's role. */
export type ResourceRequestScope =
  | { axis: 'consumption' }
  | { axis: 'cluster'; cluster: string }

export class RiseResourcePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RiseResourcePathError'
  }
}

export class RiseResourceError extends Error {
  readonly status: number
  readonly method: string
  readonly url: string
  readonly body: unknown

  constructor(opts: {
    status: number
    method: string
    url: string
    message: string
    body?: unknown
  }) {
    super(opts.message)
    this.name = 'RiseResourceError'
    this.status = opts.status
    this.method = opts.method
    this.url = opts.url
    this.body = opts.body
  }
}

function pathWithoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0]
}

// 下面这些 `[modelsphere-plugin-sdk]` 抛错是插件作者的用法诊断，**不国际化**（写死中文是规定动作）：
// 国际化规范 §1「开发者日志、调试文本和内部诊断不是默认的用户文案」= design spec §4.4 豁免 1。
// 后端返回的报错、网络与鉴权失败是另一回事 —— 那些会显给用户，走 `resourceApi.error.*`。
const DNS1123_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const RESERVED_NAMESPACE_VALUES = new Set(['_all', '_all_'])

function extractNamespaceSegment(apiPath: string): { name: string } | null {
  const match = apiPath.match(/\/namespaces\/([^/?#]+)/)
  if (!match) return null
  const name = match[1]
  if (RESERVED_NAMESPACE_VALUES.has(name)) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] namespace 段不能是保留值（' + name + '，全部聚合视图没有 ns label 路由保证）。请逐 namespace 请求。',
    )
  }
  if (!isValidDNS1123Label(name)) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] namespace 段不是合法的 DNS1123 label：' + name,
    )
  }
  return { name }
}

function isValidDNS1123Label(value: string): boolean {
  return value.length <= 63 && DNS1123_LABEL.test(value)
}

function isValidDNS1123Subdomain(value: string): boolean {
  if (value.length > 253) return false
  const labels = value.split('.')
  return labels.every((label) => isValidDNS1123Label(label))
}

function assertNoPathTraversal(apiPath: string): void {
  if (apiPath.includes('\\')) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] path 含反斜杠（浏览器会按分隔符规范化），已拒绝。',
    )
  }
  const segments = apiPath.split('/')
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw new RiseResourcePathError(
        '[modelsphere-plugin-sdk] path 段含非法百分号编码（' + segment + '），已拒绝。',
      )
    }
    if (decoded === '.' || decoded === '..') {
      throw new RiseResourcePathError(
        '[modelsphere-plugin-sdk] path 含 dot segment（' + segment + '），已拒绝。请传规范化后的路径。',
      )
    }
  }
  if (/%2e/i.test(apiPath) || /%2f/i.test(apiPath) || /%5c/i.test(apiPath)) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] path 含编码的分隔符（%2e/%2f/%5c），已拒绝。',
    )
  }
  if (/[\x00-\x1f]/.test(apiPath)) {
    throw new RiseResourcePathError('[modelsphere-plugin-sdk] path 含控制字符，已拒绝。')
  }
}

// Only platform-relative API paths are accepted: the three roots the gateway
// routes. Anything else (static assets, /login, made-up prefixes) is rejected
// so a typo cannot silently become a same-origin page fetch.
const API_ROOTS = ['/oapis/', '/api/', '/apis/']

function assertApiPath(apiPath: string): void {
  if (!API_ROOTS.some((root) => apiPath.startsWith(root))) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] scopedApi 只接受平台 API 相对路径（/oapis/…、/api/…、/apis/…），收到：' +
        apiPath +
        '。平台外的地址请用插件自己的 fetch，不要带平台凭据出域。',
    )
  }
}

function validateClusterName(cluster: string): void {
  if (cluster === '') {
    throw new RiseResourcePathError(
      "[modelsphere-plugin-sdk] axis:'cluster' 需要非空 cluster 名（真实集群名或 'host'）。",
    )
  }
  if (cluster === '_all') {
    throw new RiseResourcePathError(
      "[modelsphere-plugin-sdk] '_all' 是「全部集群」保留值，不是集群名；" +
        "axis:'cluster' 下无法表达「读全部集群」。请逐集群显式请求，或在消费轴按 Namespace 归属读。",
    )
  }
  if (!isValidDNS1123Subdomain(cluster)) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] cluster 不是合法的 DNS1123 subdomain：' + cluster,
    )
  }

}

export function buildResourcePath(path: string, scope: ResourceRequestScope): string {
  if (/^https?:\/\//i.test(path) || path.includes('://')) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] scopedApi 不接受绝对 URL（' + path + '）。' +
        '它只请求当前平台；平台外的地址请用插件自己的 fetch，不要带平台凭据出域。',
    )
  }
  if (!path.startsWith('/')) {
    throw new RiseResourcePathError(
      "[modelsphere-plugin-sdk] scopedApi path 必须是以 '/' 开头的相对路径，收到：" + path,
    )
  }
  if (path.includes('#')) {
    throw new RiseResourcePathError('[modelsphere-plugin-sdk] scopedApi path 不接受 URL fragment（#）。')
  }
  const apiPath = pathWithoutQuery(path)
  if (apiPath.startsWith('/clusters/')) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] path 已带 /clusters/ 前缀（' + path + '），请传裸路径并用 scope 声明授权轴。',
    )
  }
  assertApiPath(apiPath)
  assertNoPathTraversal(apiPath)
  // A namespace segment is validated whenever present, regardless of axis or
  // API family — every accepted family namespaces resources the same way.
  extractNamespaceSegment(apiPath)

  if (scope.axis === 'consumption') {
    return path
  }

  const { cluster } = scope
  validateClusterName(cluster)

  return '/clusters/' + encodeURIComponent(cluster) + path
}

export interface ClusterViewScope {
  cluster: string
}

export function resolveClusterViewScope(pathname?: string): ClusterViewScope | null {
  let target: string
  if (typeof pathname === 'string') {
    target = pathname
  } else {
    if (typeof window === 'undefined') return null
    target = window.location.pathname
  }

  const currentScopeMatch = target.match(/^\/cluster\/([^/]+)(?:\/|$)/)
  if (currentScopeMatch) target = currentScopeMatch[1]
  else {
    const legacyMatch = target.match(/^\/(?:boss|metrics|express)\/clusters\/([^/]+)(?:\/|$)/)
    if (!legacyMatch) return null
    target = legacyMatch[1]
  }

  if (target === '_all') return null
  let cluster: string
  try {
    cluster = decodeURIComponent(target)
  } catch {
    return null
  }
  return isValidDNS1123Subdomain(cluster) ? { cluster } : null
}

export function clusterViewScopeOrThrow(): ResourceRequestScope {
  const view = resolveClusterViewScope()
  if (!view) {
    throw new RiseResourcePathError(
      '[modelsphere-plugin-sdk] 当前页面不在 cluster 视图（URL 无 /cluster/{c} 段），' +
        "无法推导供给轴。project/workspace 页面请用 { axis: 'consumption' }。",
    )
  }
  return { axis: 'cluster', cluster: view.cluster }
}

export interface ResourceRequestOpts {
  params?: Record<string, unknown>
  signal?: AbortSignal
}

export interface ResourceResponse<T = unknown> {
  data: T
  status: number
}

function extractErrorMessage(body: unknown, status: number, statusText: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const message = record.message ?? record.error
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  if (typeof body === 'string' && body.trim() !== '') return body.trim()
  return 'HTTP ' + status + (statusText ? ' ' + statusText : '')
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function mergeQuery(path: string, params?: Record<string, unknown>): { pathname: string; query: string } {
  const separator = path.indexOf('?')
  const pathname = separator < 0 ? path : path.slice(0, separator)
  const existingQuery = separator < 0 ? '' : path.slice(separator + 1)
  const search = new URLSearchParams(existingQuery)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === '') continue
      search.set(key, String(value))
    }
  }
  const query = search.size > 0 ? '?' + search.toString() : ''
  return { pathname, query }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  scope: ResourceRequestScope,
  opts: ResourceRequestOpts & { body?: unknown; contentType?: string } = {},
): Promise<ResourceResponse<T>> {
  const built = buildResourcePath(path, scope)
  const { pathname, query } = mergeQuery(built, opts.params)
  const url = pathname + query

  let response: Response
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers:
        opts.body !== undefined ? { 'Content-Type': opts.contentType ?? 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RiseResourceError({
      status: 0,
      method,
      url,
      message: sdkT('resourceApi.error.network'),
      body: null,
    })
  }

  return readResourceResponse<T>(response, method, url)
}

async function readResourceResponse<T>(response: Response, method: string, url: string): Promise<ResourceResponse<T>> {
  if (response.status === 401 && typeof window !== 'undefined') {
    const current = window.location.pathname + window.location.search
    window.location.href = '/login?redirect=' + encodeURIComponent(current)
    throw new RiseResourceError({
      status: 401,
      method,
      url,
      message: sdkT('resourceApi.error.unauthorized'),
      body: await parseBody(response).catch(() => null),
    })
  }

  const body = await parseBody(response)
  if (!response.ok) {
    throw new RiseResourceError({
      status: response.status,
      method,
      url,
      message: extractErrorMessage(body, response.status, response.statusText),
      body,
    })
  }

  return { data: body as T, status: response.status }
}

export const scopedApi = {
  get<T = unknown>(path: string, scope: ResourceRequestScope, opts?: ResourceRequestOpts) {
    return request<T>('GET', path, scope, opts)
  },
  post<T = unknown>(
    path: string,
    scope: ResourceRequestScope,
    body?: unknown,
    opts?: Omit<ResourceRequestOpts, 'params'>,
  ) {
    return request<T>('POST', path, scope, { ...opts, body })
  },
  patch<T = unknown>(
    path: string,
    scope: ResourceRequestScope,
    body?: unknown,
    opts?: Omit<ResourceRequestOpts, 'params'>,
  ) {
    return request<T>('PATCH', path, scope, { ...opts, body, contentType: 'application/merge-patch+json' })
  },
  delete<T = unknown>(path: string, scope: ResourceRequestScope, opts?: ResourceRequestOpts) {
    return request<T>('DELETE', path, scope, opts)
  },
}
