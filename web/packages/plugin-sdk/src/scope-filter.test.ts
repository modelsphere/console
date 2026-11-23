import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'

import { useScopeFilter } from './scope-filter'
import type { UseScopeFilterOptions, UseScopeFilterResult } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>).__RISE_SDK__
})

function installHost(store: Map<string, string>) {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).__RISE_SDK__ = {
    React,
    get: (name: string) => (name === 'auth' ? { getUser: () => ({ username: 'u1' }) } : undefined),
  }
  vi.stubGlobal('window', { localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  } })
}

async function render(opts?: UseScopeFilterOptions, kind: 'workspace' | 'cluster' = 'workspace') {
  let result!: UseScopeFilterResult
  function Probe() {
    result = useScopeFilter(kind, opts)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)) })
  return { get: () => result, renderer }
}

const workspaces = (names: string[]) => ({
  ok: true,
  json: async () => ({ items: names.map(name => ({ metadata: { name } })) }),
})

it('默认取全量列表（limit=500）但忽略旧工作空间记忆', async () => {
  const store = new Map<string, string>()
  installHost(store)
  const fetch = vi.fn().mockResolvedValue(workspaces(['ws-a', 'ws-b']))
  vi.stubGlobal('fetch', fetch)
  store.set('rise-filter-workspace-u1', 'ws-b')
  const { get, renderer } = await render()
  expect(fetch.mock.calls[0][0]).toBe('/oapis/tenant.theriseunion.io/v1alpha1/workspaces?limit=500')
  expect(get().value).toBe('')
  expect(get().options.map(o => o.name)).toEqual(['ws-a', 'ws-b'])
  await act(async () => { get().setValue('ws-a') })
  expect(get().value).toBe('ws-a')
  expect(store.get('rise-filter-workspace-u1')).toBe('ws-b')
  await act(async () => { renderer.unmount() })
})

it('enabled=false：不取列表、不读写记忆，值恒为默认', async () => {
  const store = new Map<string, string>([['rise-filter-workspace-u1', 'ws-b']])
  installHost(store)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ enabled: false })
  expect(fetch).not.toHaveBeenCalled()
  expect(get().value).toBe('')
  expect(get().loading).toBe(false)
  await act(async () => { get().setValue('ws-a') })
  expect(get().value).toBe('')
  expect(store.get('rise-filter-workspace-u1')).toBe('ws-b')
  await act(async () => { renderer.unmount() })
})


it.each([
  { kind: 'cluster' as const, expected: 'Canonical alias' },
  { kind: 'workspace' as const, expected: 'Compatibility name' },
])('$kind keeps its display-name contract when both annotations exist', async ({ kind, expected }) => {
  installHost(new Map())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{
    metadata: { name: 'host', annotations: { 'theriseunion.io/alias-name': 'Canonical alias', 'theriseunion.io/display-name': 'Compatibility name' } },
  }] }) }))
  const { get, renderer } = await render(undefined, kind)
  expect(get().options[0].displayName).toBe(expected)
  await act(async () => { renderer.unmount() })
})

function installUrlHost(initial: string) {
  const listeners = new Map<string, Array<() => void>>()
  const loc = { pathname: '/observe', search: '', hash: '' }
  const apply = (url: string) => {
    const u = new URL(url, 'http://h')
    loc.pathname = u.pathname
    loc.search = u.search
    loc.hash = u.hash
  }
  apply(initial)
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => apply(url))
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).__RISE_SDK__ = { React, get: () => undefined }
  vi.stubGlobal('window', {
    location: loc,
    history: { state: null, replaceState },
    addEventListener: (n: string, f: () => void) => { listeners.set(n, [...(listeners.get(n) || []), f]) },
    removeEventListener: (n: string, f: () => void) => { listeners.set(n, (listeners.get(n) || []).filter(x => x !== f)) },
  })
  return {
    loc,
    replaceState,
    navigate: (url: string) => { apply(url); (listeners.get('popstate') || []).forEach(f => f()) },
    url: () => loc.pathname + loc.search + loc.hash,
  }
}

const clusters = (names: string[]) => workspaces(names)

it('syncUrl 缺省：不读写 URL', async () => {
  const host = installUrlHost('/observe?cluster=east')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '' }, 'cluster')
  expect(get().value).toBe('')
  await act(async () => { get().setValue('east') })
  expect(host.replaceState).not.toHaveBeenCalled()
  expect(host.url()).toBe('/observe?cluster=east')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：挂载读取参数，优先于 defaultValue；无参数用 defaultValue', async () => {
  installUrlHost('/observe?cluster=east')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east', 'west'])))
  const a = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  expect(a.get().value).toBe('east')
  await act(async () => { a.renderer.unmount() })

  installUrlHost('/observe')
  const b = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  expect(b.get().value).toBe('')
  await act(async () => { b.renderer.unmount() })
})

it('syncUrl：setValue 写/删参数，保留 pathname、hash 与其它参数', async () => {
  const host = installUrlHost('/observe?range=1h#top')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { get().setValue('east') })
  expect(host.url()).toBe('/observe?range=1h&cluster=east#top')
  expect(get().value).toBe('east')
  await act(async () => { get().setValue('') })
  expect(host.url()).toBe('/observe?range=1h#top')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：自定义参数名；defaultValue 非空时空串写成空参数', async () => {
  const host = installUrlHost('/observe')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['host', 'east'])))
  const { get, renderer } = await render({ syncUrl: { param: 'c' } }, 'cluster')
  expect(get().value).toBe('host')
  await act(async () => { get().setValue('') })
  expect(host.url()).toBe('/observe?c=')
  await act(async () => { get().setValue('host') })
  expect(host.url()).toBe('/observe')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：列表加载后无效参数回落默认并从 URL 移除', async () => {
  const host = installUrlHost('/observe?cluster=gone&range=1h')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  expect(get().value).toBe('')
  expect(host.url()).toBe('/observe?range=1h')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：popstate 重读参数', async () => {
  const host = installUrlHost('/observe')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { host.navigate('/observe?cluster=east') })
  expect(get().value).toBe('east')
  await act(async () => { host.navigate('/observe') })
  expect(get().value).toBe('')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：popstate 到候选里没有的值时回落默认并从 URL 移除', async () => {
  const host = installUrlHost('/observe?range=1h')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { host.navigate('/observe?cluster=gone&range=1h') })
  expect(get().value).toBe('')
  expect(host.url()).toBe('/observe?range=1h')
  await act(async () => { host.navigate('/observe?cluster=east&range=1h') })
  expect(get().value).toBe('east')
  expect(host.url()).toBe('/observe?cluster=east&range=1h')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：取列表失败不改写 URL，值保持 URL 值；popstate 仍按 URL 值', async () => {
  const host = installUrlHost('/observe?cluster=east&range=1h')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  expect(get().value).toBe('east')
  expect(get().options).toEqual([])
  expect(host.replaceState).not.toHaveBeenCalled()
  expect(host.url()).toBe('/observe?cluster=east&range=1h')
  await act(async () => { host.navigate('/observe?cluster=west&range=1h') })
  expect(get().value).toBe('west')
  expect(host.replaceState).not.toHaveBeenCalled()
  await act(async () => { renderer.unmount() })
})

it('syncUrl 关闭：取列表失败回落默认值', async () => {
  installUrlHost('/observe')
  let fail: (e: Error) => void = () => {}
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((_, reject) => { fail = reject })))
  const { get, renderer } = await render({ defaultValue: 'host' }, 'cluster')
  await act(async () => { get().setValue('east') })
  expect(get().value).toBe('east')
  await act(async () => { fail(new Error('network')) })
  expect(get().value).toBe('host')
  await act(async () => { renderer.unmount() })
})

it('syncUrl：replaceState 的 state 去掉 Next 内部标记并保留其它键', async () => {
  const host = installUrlHost('/observe?cluster=east')
  ;(window.history as { state: unknown }).state = {
    __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['x'], _N: 1, 'rise-navigation-owner': 'observe', other: 1,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east', 'west'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { get().setValue('west') })
  expect(host.replaceState).toHaveBeenCalledTimes(1)
  expect(host.replaceState.mock.calls[0][0]).toEqual({ 'rise-navigation-owner': 'observe', other: 1 })
  await act(async () => { renderer.unmount() })
})

it('syncUrl：state 只有 Next 标记时传 null', async () => {
  const host = installUrlHost('/observe?cluster=east')
  ;(window.history as { state: unknown }).state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east', 'west'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { get().setValue('west') })
  expect(host.replaceState.mock.calls[0][0]).toBeNull()
  await act(async () => { renderer.unmount() })
})

it('syncUrl：已离开挂载页面后的 popstate 不读不改', async () => {
  const host = installUrlHost('/observe?cluster=east')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  await act(async () => { host.navigate('/other?cluster=bogus') })
  expect(get().value).toBe('east')
  expect(host.replaceState).not.toHaveBeenCalled()
  expect(host.url()).toBe('/other?cluster=bogus')
  await act(async () => { renderer.unmount() })
})

it('syncUrl + enabled=false：不读不写 URL', async () => {
  const host = installUrlHost('/observe?cluster=east')
  vi.stubGlobal('fetch', vi.fn())
  const { get, renderer } = await render({ defaultValue: '', syncUrl: true, enabled: false }, 'cluster')
  expect(get().value).toBe('')
  await act(async () => { get().setValue('east') })
  await act(async () => { host.navigate('/observe?cluster=east') })
  expect(get().value).toBe('')
  expect(host.replaceState).not.toHaveBeenCalled()
  await act(async () => { renderer.unmount() })
})

it('error：成功路径为 null，retry 可用', async () => {
  installUrlHost('/observe')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(clusters(['east'])))
  const { get, renderer } = await render({ defaultValue: '' }, 'cluster')
  expect(get().error).toBeNull()
  expect(typeof get().retry).toBe('function')
  await act(async () => { renderer.unmount() })
})

it('error：取列表失败置 error 且 options 为空；retry 重新请求并在成功后清除 error', async () => {
  installUrlHost('/observe')
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(clusters(['east', 'west']))
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ defaultValue: '' }, 'cluster')
  expect(get().error).toBeInstanceOf(Error)
  expect(get().options).toEqual([])
  expect(get().loading).toBe(false)
  await act(async () => { get().retry?.() })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(get().error).toBeNull()
  expect(get().options.map(o => o.name)).toEqual(['east', 'west'])
  await act(async () => { renderer.unmount() })
})

it('error：HTTP 非 2xx 也算失败；retry 再失败仍保持 error', async () => {
  installUrlHost('/observe')
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ defaultValue: '' }, 'cluster')
  expect(get().error).toBeInstanceOf(Error)
  await act(async () => { get().retry?.() })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(get().error).toBeInstanceOf(Error)
  await act(async () => { renderer.unmount() })
})

it('error：retry 期间 error 清空并处于 loading', async () => {
  installUrlHost('/observe')
  let resolve: (v: unknown) => void = () => {}
  vi.stubGlobal('fetch', vi.fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockReturnValueOnce(new Promise((r) => { resolve = r })))
  const { get, renderer } = await render({ defaultValue: '' }, 'cluster')
  expect(get().error).toBeInstanceOf(Error)
  await act(async () => { get().retry?.() })
  expect(get().error).toBeNull()
  expect(get().loading).toBe(true)
  await act(async () => { resolve(clusters(['east'])) })
  expect(get().loading).toBe(false)
  expect(get().options.map(o => o.name)).toEqual(['east'])
  await act(async () => { renderer.unmount() })
})

it('error：失败时 syncUrl 关闭仍回落默认值、syncUrl 开启仍保持 URL 值（既有语义不变）', async () => {
  installUrlHost('/observe?cluster=east')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
  const a = await render({ defaultValue: '', syncUrl: true }, 'cluster')
  expect(a.get().value).toBe('east')
  expect(a.get().error).toBeInstanceOf(Error)
  await act(async () => { a.renderer.unmount() })
  const b = await render({ defaultValue: 'host' }, 'cluster')
  expect(b.get().value).toBe('host')
  expect(b.get().error).toBeInstanceOf(Error)
  await act(async () => { b.renderer.unmount() })
})

it('error：enabled=false 不取列表，error 恒为 null', async () => {
  installUrlHost('/observe')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ enabled: false }, 'cluster')
  expect(get().error).toBeNull()
  await act(async () => { get().retry?.() })
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => { renderer.unmount() })
})


it('pluginName：仅请求指定插件的可用集群，不读 Tenant 或安装记录', async () => {
  const host = installUrlHost('/observe?cluster=uninstalled')
  const fetch = vi.fn().mockResolvedValue(clusters(['installed']))
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ pluginName: 'rise.io--observe', defaultValue: '', syncUrl: true }, 'cluster')
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    '/oapis/tenant.theriseunion.io/v1alpha1/plugins/rise.io--observe/clusters?limit=-1',
  ])
  expect(get().options.map(option => option.name)).toEqual(['installed'])
  expect(get().value).toBe('')
  expect(host.url()).toBe('/observe')
  await act(async () => { host.navigate('/observe?cluster=uninstalled') })
  expect(get().value).toBe('')
  await act(async () => { host.navigate('/observe?cluster=installed') })
  expect(get().value).toBe('installed')
  await act(async () => { renderer.unmount() })
})

it('pluginName：空交集清除直链集群，不自动选 host，也不回退', async () => {
  const host = installUrlHost('/observe?cluster=host&range=1h')
  const fetch = vi.fn().mockResolvedValue(clusters([]))
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ pluginName: 'rise.io--observe', defaultValue: '', syncUrl: true }, 'cluster')
  expect(get().options).toEqual([])
  expect(get().value).toBe('')
  expect(get().error).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(host.url()).toBe('/observe?range=1h')
  await act(async () => { renderer.unmount() })
})

it.each([404, 409, 500])('pluginName：HTTP %s 保留真实错误且不 fallback，重试仍走新接口', async status => {
  const host = installUrlHost('/observe?cluster=host')
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: `plugin failure ${status}` }), { status }))
    .mockResolvedValueOnce(clusters(['installed']))
  vi.stubGlobal('fetch', fetch)
  const { get, renderer } = await render({ pluginName: 'rise.io--observe', defaultValue: '', syncUrl: true }, 'cluster')
  expect(String(get().error)).toContain(`HTTP ${status}`)
  expect(String(get().error)).toContain(`plugin failure ${status}`)
  expect(get().options).toEqual([])
  expect(host.url()).toBe('/observe?cluster=host')
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { get().retry?.() })
  expect(fetch.mock.calls.map(call => call[0])).toEqual(Array(2).fill(
    '/oapis/tenant.theriseunion.io/v1alpha1/plugins/rise.io--observe/clusters?limit=-1',
  ))
  expect(get().error).toBeNull()
  expect(get().options.map(option => option.name)).toEqual(['installed'])
  expect(get().value).toBe('')
  await act(async () => { renderer.unmount() })
})
