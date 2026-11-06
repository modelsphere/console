import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlugin } from '../src/core'
import { getBusiness, getUi } from '../src/host'
import { createMockSDK } from '../src/testing'

afterEach(() => { delete (globalThis as any).__RISE_SDK__ })

describe('PluginInstance 4.0', () => {
  it('注册插件时保留其他句柄能力，不再暴露旧 UI 字段', () => {
    const ui = { toast: { add: vi.fn() }, ConfirmDialog: () => null, Sheet: () => null }
    const business = { SpecSelect: () => null }
    const api = { get: vi.fn() }
    const registerPlugin = vi.fn()
    ;(globalThis as any).__RISE_SDK__ = { VERSION: '1.0.1', ui, business, apiClient: api, registerPlugin }

    const plugin = createPlugin({ name: 'contract-test', version: '1.0.0', displayName: 'Contract test' })
    expect(registerPlugin).toHaveBeenCalledOnce()
    expect(plugin.name).toBe('contract-test')
    expect(plugin.api).toBe(api)
    expect(typeof plugin.events.on).toBe('function')
    expect(typeof plugin.nav.addMenu).toBe('function')
    expect(Object.prototype.hasOwnProperty.call(plugin, 'ui')).toBe(false)
    expect(getUi()).toBe(ui)
    expect(getBusiness()).toBe(business)
    expect((globalThis as any).__RISE_SDK__.VERSION).toBe('1.0.1')
  })

  it('测试替身完成注册，但不提供已经删除的 UI 空字段', () => {
    const mock = createMockSDK()
    const plugin = mock.createPlugin({ name: 'mock-contract-test', version: '1.0.0' }) as Record<string, unknown>
    expect(mock.registeredPlugins).toHaveLength(1)
    expect(plugin.name).toBe('mock-contract-test')
    expect(Object.prototype.hasOwnProperty.call(plugin, 'ui')).toBe(false)
  })
})
