import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createServer } from 'vite'
import { definePluginDevConfig } from '../src/dev'
import { developmentSharedModules } from '../src/dev-shared'

const directories: string[] = []
afterEach(() => { directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })) })

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'modelsphere-dev-'))
  directories.push(root)
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, 'web/src'), { recursive: true })
  writeFileSync(path.join(root, 'src/runtime.tsx'), 'export const component = "fixture"')
  writeFileSync(path.join(root, 'Chart.yaml'), 'version: 1.2.3\n')
  writeFileSync(path.join(root, 'web/src/index.css'), '')
  return root
}

it('transforms the bootstrap and keeps all development requests inside the plugin proxy', async () => {
  const root = fixture()
  const config = definePluginDevConfig({ name: 'example', root, hostSource: root, hostOrigin: 'http://127.0.0.1:5173' })
  // The source preset is under test; published presets resolve compiled .mjs shims.
  const aliases = config.resolve?.alias
  if (Array.isArray(aliases)) for (const alias of aliases) alias.replacement = alias.replacement.replace(/-shim\.mjs$/, '-shim.ts')
  const server = await createServer({ ...config, configFile: false, optimizeDeps: { ...config.optimizeDeps, noDiscovery: true, include: [] }, server: { middlewareMode: true } })
  try {
    const result = await server.transformRequest('/plugins/example/__modelsphere_entry.ts')
    expect(result?.code).toContain('http://127.0.0.1:5173/@react-refresh')
    expect(result?.code).toContain('/plugins/example/@vite/client')
    expect(result?.code).toContain('/plugins/example/src/runtime.tsx')
    expect(result?.code).toContain('/plugins/example/@fs/')
  } finally { await server.close() }
})

it('configures a same-origin WebSocket and injects the chart version', () => {
  const root = fixture()
  const config = definePluginDevConfig({ name: 'example', root, hostSource: root, hostOrigin: 'https://console.example.test' })
  expect(config.server?.hmr).toMatchObject({ host: 'console.example.test', protocol: 'wss', clientPort: 443, path: '__hmr' })
  expect(config.define?.__PLUGIN_VERSION__).toBe('"1.2.3"')
  expect(config.server?.cors).toEqual({ origin: 'https://console.example.test' })
})

it('updates shared exports and invalidates their cached modules before refreshing a page', async () => {
  const root = fixture()
  const directory = path.join(root, '.modelsphere')
  mkdirSync(directory)
  const shared = developmentSharedModules(root, directory)
  const cachedModule = { id: 'cached-router' }
  const invalidated: unknown[] = []
  writeFileSync(path.join(root, 'src/runtime.tsx'), 'import { Link } from "react-router"; export const component = Link')
  const context = { file: path.join(root, 'src/runtime.tsx'), timestamp: 123, modules: [], server: { moduleGraph: {
    getModulesByFile: () => new Set([cachedModule]), invalidateModule: (module: unknown) => invalidated.push(module),
  } } }
  const hook = shared.plugin.handleHotUpdate
  if (typeof hook !== 'function') throw new Error('Missing shared-module HMR hook')
  await hook.call({} as never, context as never)
  expect(readFileSync(path.join(directory, 'react-router.mjs'), 'utf8')).toContain('export const Link=shared.Link')
  expect(invalidated).toContain(cachedModule)
})
