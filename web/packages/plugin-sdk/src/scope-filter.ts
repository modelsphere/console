import { getHostSDK } from './host'
import type {
  ScopeFilterKind,
  ScopeFilterOption,
  UseScopeFilterOptions,
  UseScopeFilterResult,
} from './types'

type ReactLike = {
  useCallback: <T extends (...args: any[]) => any>(callback: T, deps: unknown[]) => T
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initial: T) => { current: T }
  useState: <T>(initial: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void]
}

type K8sListItem = {
  metadata?: {
    name?: string
    annotations?: Record<string, string>
  }
  spec?: Record<string, unknown>
}

type K8sList = {
  items?: K8sListItem[]
}

const DISPLAY_NAME_ANNOTATIONS = [
  'theriseunion.io/display-name',
  'theriseunion.io/alias-name',
  'rise.io/display-name',
  'displayName',
  'display-name',
]

function getReact(): ReactLike {
  return getHostSDK().React as ReactLike
}

function getDefaultValue(kind: ScopeFilterKind, opts?: UseScopeFilterOptions): string {
  return opts?.defaultValue ?? (kind === 'cluster' ? 'host' : '')
}

function getUrlParam(kind: ScopeFilterKind, opts?: UseScopeFilterOptions): string | null {
  const sync = opts?.syncUrl
  if (!sync) return null
  return (typeof sync === 'object' && sync.param) || kind
}

function hasLocation(): boolean {
  return typeof window !== 'undefined' && !!window.location && !!window.history
}

/** 参数缺省返回 null；`?p=` 返回空串。 */
function readUrlParam(param: string): string | null {
  if (!hasLocation()) return null
  return new URLSearchParams(window.location.search).get(param)
}

/** Next app-router 写入 history.state 的内部键；带着它们调用 replaceState，Next 的补丁会放行而不更新自己记录的 URL。 */
const NEXT_STATE_KEYS = ['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE', '_N']

/** 去掉 Next 内部键、保留其它键（含宿主壳的 navigation owner）；无剩余键时为 null。 */
function stateWithoutNextMarkers(state: unknown): Record<string, unknown> | null {
  if (!state || typeof state !== 'object') return null
  const rest = { ...(state as Record<string, unknown>) }
  for (const key of NEXT_STATE_KEYS) delete rest[key]
  return Object.keys(rest).length ? rest : null
}

/**
 * value 为 null 时移除参数；只改 query，保留 pathname、hash 与其它参数，用 replaceState 不增加历史条目。
 * state 先去掉 Next 内部标记，Next 补丁过的 replaceState 才会采纳新 URL（useSearchParams 随之更新）。
 */
function writeUrlParam(param: string, value: string | null) {
  if (!hasLocation()) return
  const params = new URLSearchParams(window.location.search)
  if (value === null) params.delete(param)
  else params.set(param, value)
  const search = params.toString()
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  window.history.replaceState(stateWithoutNextMarkers(window.history.state), '', next)
}

function displayNameOf(item: K8sListItem, cluster = false): string | undefined {
  const annotations = item.metadata?.annotations || {}
  if (cluster) {
    const alias = annotations['theriseunion.io/alias-name']
    if (typeof alias === 'string' && alias.trim()) return alias
  }
  for (const key of DISPLAY_NAME_ANNOTATIONS) {
    const value = annotations[key]
    if (typeof value === 'string' && value.trim()) return value
  }

  const spec = item.spec || {}
  for (const key of ['displayName', 'display_name', 'aliasName', 'alias']) {
    const value = spec[key]
    if (typeof value === 'string' && value.trim()) return value
  }

  return undefined
}

function mapOptions(list: K8sList, cluster = false): ScopeFilterOption[] {
  return (list.items || [])
    .map((item) => {
      const name = item.metadata?.name || ''
      if (!name) return null
      const displayName = displayNameOf(item, cluster)
      return displayName ? { name, displayName } : { name }
    })
    .filter((item): item is ScopeFilterOption => item !== null)
}

function useScopeSelection(kind: ScopeFilterKind, opts?: UseScopeFilterOptions) {
  const React = getReact()
  const defaultValue = getDefaultValue(kind, opts)
  const enabled = opts?.enabled !== false
  const urlParam = enabled ? getUrlParam(kind, opts) : null
  const initialValue = () => (urlParam ? readUrlParam(urlParam) ?? defaultValue : defaultValue)
  const [value, setValueState] = React.useState(initialValue)
  React.useEffect(() => { setValueState(initialValue()) }, [kind, opts?.defaultValue, enabled, urlParam])
  return { defaultValue, enabled, urlParam, value, setValueState }
}

type Selection = ReturnType<typeof useScopeSelection>

function useScopeHistory(selection: Selection, options: ScopeFilterOption[]) {
  const React = getReact()
  const { urlParam, defaultValue, setValueState } = selection
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useEffect(() => {
    if (!urlParam || typeof window === 'undefined' || !window.addEventListener) return
    const mountedPath = hasLocation() ? window.location.pathname : null
    const onPopState = () => {
      if (hasLocation() && window.location.pathname !== mountedPath) return
      const next = readUrlParam(urlParam) ?? defaultValue
      const loaded = optionsRef.current
      if (next !== '' && loaded.length > 0 && !loaded.some(option => option.name === next)) {
        setValueState(defaultValue)
        writeUrlParam(urlParam, null)
        return
      }
      setValueState(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [urlParam, defaultValue])
}

async function fetchScopeOptions(kind: ScopeFilterKind, pluginName?: string): Promise<K8sList> {
  const resource = kind === 'cluster' ? 'clusters' : 'workspaces'
  // Fetch all candidates so a remembered selection beyond the first page stays valid.
  const url = pluginName
    ? `/oapis/tenant.theriseunion.io/v1alpha1/plugins/${encodeURIComponent(pluginName)}/clusters?limit=-1`
    : `/oapis/tenant.theriseunion.io/v1alpha1/${resource}?limit=500`
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const reason = pluginName ? await response.text() : ''
    throw new Error(`HTTP ${response.status}${reason ? `: ${reason}` : ''}`)
  }
  return response.json() as Promise<K8sList>
}

function useScopeOptions(kind: ScopeFilterKind, selection: Selection, pluginName?: string) {
  const React = getReact()
  const { defaultValue, enabled, urlParam, setValueState, value } = selection
  const valueRef = React.useRef(value)
  valueRef.current = value
  const [options, setOptions] = React.useState<ScopeFilterOption[]>([])
  const [loading, setLoading] = React.useState(enabled)
  const [error, setError] = React.useState<unknown | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  React.useEffect(() => {
    if (!enabled) {
      setOptions([])
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchScopeOptions(kind, pluginName).then(list => {
      if (cancelled) return
      const nextOptions = mapOptions(list, kind === 'cluster')
      setOptions(nextOptions)
      setError(null)
      const current = valueRef.current
      if (current === '' || nextOptions.some(option => option.name === current)) return
      setValueState(defaultValue)
      if (urlParam) writeUrlParam(urlParam, null)
    }).catch((failure: unknown) => {
      if (cancelled) return
      setOptions([])
      setError(failure ?? new Error('request failed'))
      // A failed URL-synced request preserves the selection for a later retry.
      if (!urlParam) setValueState(defaultValue)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [defaultValue, kind, enabled, urlParam, reloadToken, pluginName])
  const retry = React.useCallback(() => { setReloadToken(token => token + 1) }, [])
  return { options, loading, error, retry }
}

export function useScopeFilter(kind: ScopeFilterKind, opts?: UseScopeFilterOptions): UseScopeFilterResult {
  const React = getReact()
  const selection = useScopeSelection(kind, opts)
  const { enabled, defaultValue, urlParam, value, setValueState } = selection
  const result = useScopeOptions(kind, selection, kind === 'cluster' ? opts?.pluginName : undefined)
  useScopeHistory(selection, result.options)
  const setValue = React.useCallback((next: string) => {
    if (!enabled) return
    setValueState(next)
    if (urlParam) writeUrlParam(urlParam, next === defaultValue ? null : next)
  }, [enabled, urlParam, defaultValue])
  return { value, setValue, ...result }
}
