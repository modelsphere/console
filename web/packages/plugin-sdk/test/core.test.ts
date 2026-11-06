import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginDefinition, PluginEventMap, RiseHostSDK } from '../src/types'

const baseDefinition: PluginDefinition = {
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
}

function installHost(version = '1.0.0', extra: Partial<RiseHostSDK> = {}) {
  const registerPlugin = vi.fn()
  const host = {
    VERSION: version,
    registerPlugin,
    registerPluginComponent: vi.fn(),
    registerPluginRoutes: vi.fn(),
    registerSlot: vi.fn(),
    apiClient: {},
    ...extra,
  } as unknown as RiseHostSDK
  const runtime = globalThis as typeof globalThis & { __RISE_SDK__?: RiseHostSDK }
  runtime.__RISE_SDK__ = host
  return { host, registerPlugin }
}

async function loadCreatePlugin() {
  return (await import('../src/core')).createPlugin
}

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  const runtime = globalThis as typeof globalThis & { __RISE_SDK__?: RiseHostSDK }
  delete runtime.__RISE_SDK__
})

describe('typed events', () => {
  it('notifies subscribers in order and supports unsubscribe', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const calls: string[] = []
    const unsubscribeFirst = events.on('scope:change', () => calls.push('first'))
    events.on('scope:change', () => calls.push('second'))

    events.emit('scope:change', { scope: 'cluster', value: 'c1', full: 'cluster/c1' })
    unsubscribeFirst()
    events.emit('scope:change', { scope: 'cluster', value: 'c2', full: 'cluster/c2' })

    expect(calls).toEqual(['first', 'second', 'second'])
  })

  it('runs once handlers only once', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const handler = vi.fn()
    events.once('scope:change', handler)

    events.emit('scope:change', { scope: 'workspace', value: 'w1', full: 'workspace/w1' })
    events.emit('scope:change', { scope: 'workspace', value: 'w2', full: 'workspace/w2' })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('isolates handler failures', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthyHandler = vi.fn()
    events.on('scope:change', () => {
      throw new Error('broken subscriber')
    })
    events.on('scope:change', healthyHandler)

    expect(() => {
      events.emit('scope:change', { scope: 'platform', value: 'global', full: 'platform/global' })
    }).not.toThrow()
    expect(healthyHandler).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      "[modelsphere-plugin-sdk] events handler error for 'scope:change':",
      expect.any(Error),
    )
  })

  it('replays the latest snapshot to new on and once subscribers', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const snapshot = { scope: 'namespace' as const, value: 'ns1', full: 'namespace/ns1' }
    events.emit('scope:change', snapshot)
    const onHandler = vi.fn()
    const onceHandler = vi.fn()

    events.on('scope:change', onHandler)
    events.once('scope:change', onceHandler)
    events.emit('scope:change', { scope: 'namespace', value: 'ns2', full: 'namespace/ns2' })

    expect(onHandler).toHaveBeenNthCalledWith(1, snapshot)
    expect(onHandler).toHaveBeenCalledTimes(2)
    expect(onceHandler).toHaveBeenCalledOnce()
    expect(onceHandler).toHaveBeenCalledWith(snapshot)
  })

  it('does not replay snapshots for non-state reserved events', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    events.emit('plugin:enabled', undefined)
    events.emit('nav:change', undefined)

    const handler = vi.fn()
    events.on('plugin:enabled', handler)
    events.on('nav:change', handler)

    expect(handler).not.toHaveBeenCalled()
  })

  it('isolates async handler rejections without interrupting others', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthyHandler = vi.fn()
    events.on('scope:change', async () => {
      throw new Error('async broken subscriber')
    })
    events.on('scope:change', healthyHandler)

    expect(() => {
      events.emit('scope:change', { scope: 'platform', value: 'global', full: 'platform/global' })
    }).not.toThrow()
    expect(healthyHandler).toHaveBeenCalledOnce()

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        "[modelsphere-plugin-sdk] events handler error for 'scope:change':",
        expect.any(Error),
      )
    })
  })

  it('bridges on/once/emit to a host-provided event bus', async () => {
    const hostUnsubscribe = vi.fn()
    const hostOn = vi.fn(() => hostUnsubscribe)
    const hostOnce = vi.fn(() => hostUnsubscribe)
    const hostEmit = vi.fn()
    const { host, registerPlugin } = installHost('1.0.0', {
      on: hostOn,
      once: hostOnce,
      emit: hostEmit,
    })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const handler = vi.fn()

    const unsubscribe = events.on('scope:change', handler)
    expect(hostOn).toHaveBeenCalledWith('scope:change', expect.any(Function), baseDefinition.name)
    expect(unsubscribe).toBe(hostUnsubscribe)

    const onceUnsubscribe = events.once('scope:change', handler)
    expect(hostOnce).toHaveBeenCalledWith('scope:change', expect.any(Function), baseDefinition.name)
    expect(onceUnsubscribe).toBe(hostUnsubscribe)

    events.emit('scope:change', { scope: 'cluster', value: 'c1', full: 'cluster/c1' })
    expect(hostEmit).toHaveBeenCalledWith(
      'scope:change',
      expect.objectContaining({ scope: 'cluster', value: 'c1' }),
    )

    // Host bridge must not register the plugin twice or touch the internal bus.
    expect(registerPlugin).toHaveBeenCalledOnce()
    expect(host.on).not.toBeUndefined()
  })

  it('isolates sync throws and async rejections delivered via the host bridge', async () => {
    const hostUnsubscribe = vi.fn()
    const hostOn = vi.fn((_event: string, _handler: (data: unknown) => unknown) => hostUnsubscribe)
    const hostOnce = vi.fn((_event: string, _handler: (data: unknown) => unknown) => hostUnsubscribe)
    const hostEmit = vi.fn()
    installHost('1.0.0', { on: hostOn, once: hostOnce, emit: hostEmit })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthy = vi.fn()

    events.on('scope:change', () => {
      throw new Error('sync broken via bridge')
    })
    events.on('scope:change', async () => {
      throw new Error('async broken via bridge')
    })
    events.on('scope:change', healthy)

    // Host delivers an event to each wrapped subscriber; nothing may throw
    // through to the host, and no unhandledRejection may surface.
    const wrappedHandlers = hostOn.mock.calls.map((call) => call[1])
    expect(wrappedHandlers).toHaveLength(3)
    const payload = { scope: 'cluster' as const, value: 'c1', full: 'cluster/c1' }
    for (const wrapped of wrappedHandlers) {
      expect(() => wrapped(payload)).not.toThrow()
    }
    expect(healthy).toHaveBeenCalledOnce()

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledTimes(2)
    })
  })

  it('replays the local snapshot through the host bridge', async () => {
    const hostUnsubscribe = vi.fn()
    const hostOn = vi.fn(() => hostUnsubscribe)
    const hostOnce = vi.fn(() => hostUnsubscribe)
    const hostEmit = vi.fn()
    installHost('1.0.0', { on: hostOn, once: hostOnce, emit: hostEmit })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const snapshot = { scope: 'namespace' as const, value: 'ns1', full: 'namespace/ns1' }
    events.emit('scope:change', snapshot)
    expect(hostEmit).toHaveBeenCalledWith('scope:change', snapshot)

    const onHandler = vi.fn()
    events.on('scope:change', onHandler)
    // Snapshot replay is SDK-side and independent of the host implementation.
    expect(onHandler).toHaveBeenCalledWith(snapshot)
    // Still registered with the host for future broadcasts.
    expect(hostOn).toHaveBeenCalledTimes(1)
  })

  it('mirrors host broadcasts into the local snapshot for late subscribers', async () => {
    let hostHandler: ((data: unknown) => unknown) | undefined
    const hostOn = vi.fn((_event: string, handler: (data: unknown) => unknown) => {
      hostHandler = handler
      return vi.fn()
    })
    installHost('1.0.0', {
      on: hostOn,
      once: vi.fn(),
      emit: vi.fn(),
    })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    events.on('scope:change', vi.fn())
    const snapshot = { scope: 'workspace' as const, value: 'ws1', full: 'workspace/ws1' }

    hostHandler?.(snapshot)
    const lateHandler = vi.fn()
    events.on('scope:change', lateHandler)

    expect(lateHandler).toHaveBeenCalledOnce()
    expect(lateHandler).toHaveBeenCalledWith(snapshot)
  })

  it('mirrors host once broadcasts into the local snapshot for late subscribers', async () => {
    let hostOnceHandler: ((data: unknown) => unknown) | undefined
    const hostOnce = vi.fn((_event: string, handler: (data: unknown) => unknown) => {
      hostOnceHandler = handler
      return vi.fn()
    })
    const hostOn = vi.fn(() => vi.fn())
    installHost('1.0.0', { on: hostOn, once: hostOnce, emit: vi.fn() })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const onceHandler = vi.fn()
    events.once('scope:change', onceHandler)
    const snapshot = { scope: 'workspace' as const, value: 'ws1', full: 'workspace/ws1' }

    hostOnceHandler?.(snapshot)
    const lateHandler = vi.fn()
    events.on('scope:change', lateHandler)

    expect(onceHandler).toHaveBeenCalledOnce()
    expect(onceHandler).toHaveBeenCalledWith(snapshot)
    expect(lateHandler).toHaveBeenCalledOnce()
    expect(lateHandler).toHaveBeenCalledWith(snapshot)
  })

  it('replays getScope before the first host subscription', async () => {
    const hostOn = vi.fn(() => vi.fn())
    const hostOnce = vi.fn(() => vi.fn())
    const current = { scope: 'workspace' as const, value: 'ws1', full: 'workspace/ws1' }
    const getScope = vi.fn(() => current)
    installHost('1.0.0', {
      on: hostOn,
      once: hostOnce,
      emit: vi.fn(),
      getScope,
    })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const onHandler = vi.fn()
    const onceHandler = vi.fn()

    events.on('scope:change', onHandler)
    events.once('scope:change', onceHandler)

    expect(onHandler).toHaveBeenCalledWith(current)
    expect(hostOn).toHaveBeenCalledOnce()
    expect(onceHandler).toHaveBeenCalledWith(current)
    expect(hostOnce).not.toHaveBeenCalled()
    expect(getScope).toHaveBeenCalledTimes(2)
  })

  it('assigns bridged on and once subscriptions to the creating plugin', async () => {
    const hostOn = vi.fn()
    const hostOnce = vi.fn()
    installHost('1.0.0', { on: hostOn, once: hostOnce, emit: vi.fn() })
    const createPlugin = await loadCreatePlugin()
    const definition = { ...baseDefinition, name: 'owned-plugin' }
    const events = createPlugin(definition).events

    events.on('nav:change', vi.fn())
    events.once('plugin:enabled', vi.fn())

    expect(hostOn).toHaveBeenCalledWith('nav:change', expect.any(Function), 'owned-plugin')
    expect(hostOnce).toHaveBeenCalledWith('plugin:enabled', expect.any(Function), 'owned-plugin')
  })

  it('consumes a once subscription from the local snapshot without host registration', async () => {
    const hostUnsubscribe = vi.fn()
    const hostOn = vi.fn(() => hostUnsubscribe)
    const hostOnce = vi.fn(() => hostUnsubscribe)
    const hostEmit = vi.fn()
    installHost('1.0.0', { on: hostOn, once: hostOnce, emit: hostEmit })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const snapshot = { scope: 'platform' as const, value: 'global', full: 'platform/global' }
    events.emit('scope:change', snapshot)

    const onceHandler = vi.fn()
    events.once('scope:change', onceHandler)
    expect(onceHandler).toHaveBeenCalledWith(snapshot)
    expect(hostOnce).not.toHaveBeenCalled()
  })

  it('does not bridge when the host lacks a complete event bus', async () => {
    const hostOn = vi.fn()
    const hostOnce = vi.fn()
    // No host.emit -> all-or-nothing bridging is off -> in-SDK bus fallback.
    installHost('1.0.0', { on: hostOn, once: hostOnce })
    const createPlugin = await loadCreatePlugin()
    const events = createPlugin(baseDefinition).events
    const handler = vi.fn()
    const snapshot = { scope: 'cluster' as const, value: 'c1', full: 'cluster/c1' }

    events.emit('scope:change', snapshot)
    events.on('scope:change', handler)

    expect(handler).toHaveBeenCalledWith(snapshot) // internal snapshot replay worked
    expect(hostOn).not.toHaveBeenCalled() // not bridged
  })
})

describe('registration contract validation', () => {
  it('reports the plugin name and nested menu field path', async () => {
    const { registerPlugin } = installHost()
    const createPlugin = await loadCreatePlugin()
    const invalid = {
      ...baseDefinition,
      name: 'broken-menu',
      menus: [{ name: 'parent', path: '/parent', scope: 'console', children: [{ name: 'child', scope: 'console' }] }],
    } as unknown as PluginDefinition

    expect(() => createPlugin(invalid)).toThrow("plugin 'broken-menu': menus[0].children[0].path 缺失")
    expect(registerPlugin).not.toHaveBeenCalled()
  })

  it('rejects malformed scope declarations before registration', async () => {
    const { registerPlugin } = installHost()
    const createPlugin = await loadCreatePlugin()
    const invalid = {
      ...baseDefinition,
      name: 'broken-scope',
      scopes: [{ title: 'Missing scope' }],
    } as unknown as PluginDefinition

    expect(() => createPlugin(invalid)).toThrow("plugin 'broken-scope': scopes[0].scope 缺失")
    expect(registerPlugin).not.toHaveBeenCalled()
  })

  it('accepts valid menu and scope declarations', async () => {
    const { registerPlugin } = installHost()
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin({
      ...baseDefinition,
      scopes: [{ scope: 'workspace', title: 'Workspace' }],
      menus: [{ name: 'overview', path: '/overview', scope: 'workspace', requiredScope: ['workspace'] }],
    })).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })

  it('accepts project as a required menu scope', async () => {
    const { registerPlugin } = installHost()
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin({
      ...baseDefinition,
      menus: [{ name: 'project', path: '/project', scope: 'project', requiredScope: ['project'] }],
    })).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })

  it('rejects a definition without a plugin name before registration', async () => {
    const { registerPlugin } = installHost()
    const createPlugin = await loadCreatePlugin()
    const invalid = { version: '1.0.0', displayName: 'No Name' } as unknown as PluginDefinition

    expect(() => createPlugin(invalid)).toThrow("plugin '<plugin>': name 缺失")
    expect(registerPlugin).not.toHaveBeenCalled()
  })
})

describe('lifecycle context', () => {
  it('uses the current host getScope payload for onMount', async () => {
    const current = { scope: 'workspace' as const, value: 'ws1', full: 'workspace/ws1' }
    const getScope = vi.fn(() => current)
    installHost('1.0.0', { getScope })
    const createPlugin = await loadCreatePlugin()
    const onMount = vi.fn()

    createPlugin({ ...baseDefinition, onMount })

    expect(getScope).toHaveBeenCalledOnce()
    expect(onMount).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'workspace', value: 'ws1', full: 'workspace/ws1' },
    }))
  })

  it('falls back when host getScope is missing', async () => {
    installHost()
    const createPlugin = await loadCreatePlugin()
    const onMount = vi.fn()

    createPlugin({ ...baseDefinition, onMount })

    expect(onMount).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'platform', value: 'global', full: 'platform/global' },
    }))
  })

  it('falls back when host getScope returns null', async () => {
    installHost('1.0.0', { getScope: () => null })
    const createPlugin = await loadCreatePlugin()
    const onMount = vi.fn()

    createPlugin({ ...baseDefinition, onMount })

    expect(onMount).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'platform', value: 'global', full: 'platform/global' },
    }))
  })

  it.each([
    { scope: 'unknown', value: 'ws1', full: 'workspace/ws1' },
    { scope: 'workspace', value: '', full: 'workspace/ws1' },
    { scope: 'workspace', value: 'ws1', full: 'workspace/OTHER' },
  ])('falls back when the host getScope payload is invalid: $scope/$value', async (payload) => {
    installHost('1.0.0', {
      getScope: () => payload as unknown as PluginEventMap['scope:change'],
    })
    const createPlugin = await loadCreatePlugin()
    const onMount = vi.fn()

    createPlugin({ ...baseDefinition, onMount })

    expect(onMount).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'platform', value: 'global', full: 'platform/global' },
    }))
  })

  it('falls back without throwing when host getScope throws', async () => {
    installHost('1.0.0', {
      getScope: () => {
        throw new Error('scope unavailable')
      },
    })
    const createPlugin = await loadCreatePlugin()
    const onMount = vi.fn()

    expect(() => createPlugin({ ...baseDefinition, onMount })).not.toThrow()
    expect(onMount).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: 'platform', value: 'global', full: 'platform/global' },
    }))
  })
})

describe('SDK version compatibility', () => {
  it('accepts matching major versions', async () => {
    const { registerPlugin } = installHost('1.9.0')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })

  it('throws with host and SDK versions when majors differ', async () => {
    const { registerPlugin } = installHost('2.0.0')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).toThrow('Version mismatch: host 2.0.0, SDK 1.0.1')
    expect(registerPlugin).not.toHaveBeenCalled()
  })

  it('accepts host versions with a leading v prefix', async () => {
    const { registerPlugin } = installHost('v1.0.0')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })

  it('accepts prerelease host versions with the same major', async () => {
    const { registerPlugin } = installHost('v1.0.0-beta')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })

  it('throws for v-prefixed versions whose major differs', async () => {
    const { registerPlugin } = installHost('v2.0.0')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).toThrow('Version mismatch: host v2.0.0, SDK 1.0.1')
    expect(registerPlugin).not.toHaveBeenCalled()
  })

  it('rejects the real legacy host version shape before registration', async () => {
    const { registerPlugin } = installHost('0.1.0')
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).toThrow(/Version mismatch: host 0\.1\.0/)
    expect(registerPlugin).not.toHaveBeenCalled()
  })

  it('fails open when the host declares no version', async () => {
    const { host, registerPlugin } = installHost()
    delete host.VERSION
    const createPlugin = await loadCreatePlugin()

    expect(() => createPlugin(baseDefinition)).not.toThrow()
    expect(registerPlugin).toHaveBeenCalledOnce()
  })
})
