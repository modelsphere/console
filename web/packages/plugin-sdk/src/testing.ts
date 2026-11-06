// @modelsphere/plugin-sdk/testing — Mock utilities for plugin development

export interface MockSDKOptions {
  tenant?: { id: string; name: string; displayName: string }
  user?: { id: string; name: string; roles: string[] }
  viewMode?: 'console' | 'boss'
  locale?: string
}

export interface MockSDK {
  React: unknown
  VERSION: string
  registerPlugin: (def: unknown) => void
  registerPluginComponent: (pluginName: string, componentName: string, component: unknown) => void
  registerSlot: (def: unknown) => void
  registerSection: (def: unknown) => void
  createPlugin: (def: unknown) => unknown
  registeredPlugins: unknown[]
  registeredComponents: Array<{ pluginName: string; componentName: string; component: unknown }>
  registeredSlots: unknown[]
  registeredSections: unknown[]
}

/**
 * Create a mock SDK for testing plugins outside of Rise Console.
 *
 * Records all registration calls for assertion.
 *
 * @example
 * ```ts
 * import { createMockSDK } from '@modelsphere/plugin-sdk/testing'
 *
 * const mock = createMockSDK({ tenant: { id: 't1', name: 'Test', displayName: 'Test Org' } })
 * ;(window as any).__RISE_SDK__ = mock
 *
 * // Load your plugin...
 * require('./index')
 *
 * // Assert registrations
 * expect(mock.registeredPlugins).toHaveLength(1)
 * expect(mock.registeredPlugins[0].name).toBe('hello-world')
 * expect(mock.registeredComponents).toHaveLength(1)
 * ```
 */
function registerMockPlugin(mock: MockSDK, def: any) {
  if (!def?.name) return def
  // Register sections
  if (def.sections) {
    for (const section of def.sections) {
      mock.registerSection({
        name: section.name,
        displayName: section.displayName,
        icon: section.icon || '',
        order: section.order ?? 999,
        scope: section.scope || '',
      })
    }
  }
  // Register menus
  mock.registerPlugin({
    name: def.name,
    version: def.version || '0.0.0',
    displayName: def.displayName || def.name,
    menus: (def.menus || []).map((m: any) => ({
      ...m,
      scope: m.scope || '',
    })),
  })
  // Register components
  if (def.components) {
    for (const [name, comp] of Object.entries(def.components)) {
      mock.registerPluginComponent(def.name, name, comp)
    }
  }
  // Register slots
  if (def.slots) {
    for (const slot of def.slots as any[]) {
      mock.registerSlot({ ...slot, plugin: def.name })
    }
  }
  return { name: def.name, api: {}, events: {}, nav: {} }
}

export function createMockSDK(opts?: MockSDKOptions): MockSDK {
  const registeredPlugins: unknown[] = []
  const registeredComponents: MockSDK['registeredComponents'] = []
  const registeredSlots: unknown[] = []
  const registeredSections: unknown[] = []

  const mock: MockSDK = {
    VERSION: '0.1.0',
    React: { createElement: () => null },
    registeredPlugins,
    registeredComponents,
    registeredSlots,
    registeredSections,

    registerPlugin(def: unknown) {
      registeredPlugins.push(def)
    },

    registerPluginComponent(pluginName: string, componentName: string, component: unknown) {
      registeredComponents.push({ pluginName, componentName, component })
    },

    registerSlot(def: unknown) {
      registeredSlots.push(def)
    },

    registerSection(def: unknown) {
      registeredSections.push(def)
    },

    createPlugin: (def: unknown) => registerMockPlugin(mock, def),
  }

  return mock
}
