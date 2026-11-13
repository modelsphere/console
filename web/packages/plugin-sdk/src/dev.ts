import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { HOST_SURFACES } from './shared-imports'
import { readChartVersion } from './build'
import { developmentSharedModules } from './dev-shared'

export interface PluginDevOptions {
  name: string
  hostSource: string
  hostOrigin: string
  root?: string
  entry?: string
  host?: string
  port?: number
}

function developmentEntry(entry: string, stylesheet: string, hostOrigin: string): Plugin {
  const id = '\0modelsphere-plugin-entry'
  return {
    name: 'modelsphere-plugin-development-entry',
    resolveId(source) { if (source.endsWith('/__modelsphere_entry.ts') || source === '__modelsphere_entry.ts') return id },
    load(source) {
      if (source !== id) return
      return `import RefreshRuntime from ${JSON.stringify(hostOrigin + '/@react-refresh')};
if (!window.__vite_plugin_react_preamble_installed__) RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
await import("/@vite/client");
await import(${JSON.stringify('/@fs' + stylesheet)});
await import(${JSON.stringify('/' + entry)});
if (import.meta.hot) import.meta.hot.accept(${JSON.stringify('/' + entry)}, () => window.location.reload());`
    },
  }
}

/** Serve source modules and HMR through the configured Console plugin proxy. */
export function definePluginDevConfig(options: PluginDevOptions) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(options.name)) throw new Error('Plugin name must be lowercase kebab-case')
  const origin = new URL(options.hostOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('hostOrigin must be a Console HTTP(S) origin')
  const root = path.resolve(options.root ?? process.cwd())
  const host = fs.realpathSync(path.resolve(options.hostSource, 'web'))
  const base = `/plugins/${options.name}/`
  const generated = path.join(root, '.modelsphere', 'dev')
  fs.mkdirSync(generated, { recursive: true })
  const shared = developmentSharedModules(root, generated)
  const stylesheet = path.join(generated, 'style.css')
  fs.writeFileSync(stylesheet, `@import ${JSON.stringify(path.join(host, 'src/index.css'))};\n@source ${JSON.stringify(path.join(root, 'src'))};\n`)
  const sdk = path.dirname(fileURLToPath(import.meta.url))
  return defineConfig({
    root, base, appType: 'custom',
    define: { __PLUGIN_VERSION__: JSON.stringify(readChartVersion(root, options.name)) },
    plugins: [shared.plugin, developmentEntry(options.entry ?? 'src/runtime.tsx', stylesheet, origin.origin), react({ reactRefreshHost: origin.origin }), tailwind()],
    resolve: { alias: [
      { find: /^react\/jsx-(?:dev-)?runtime$/, replacement: path.join(sdk, 'react-jsx-runtime-shim.mjs') },
      { find: /^(react|react-dom)$/, replacement: path.join(sdk, 'react-shim.mjs') },
      ...shared.aliases,
    ] },
    optimizeDeps: { exclude: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@modelsphere/plugin-sdk', ...Object.keys(HOST_SURFACES)] },
    server: {
      host: options.host ?? '127.0.0.1', port: options.port ?? 4181, strictPort: true,
      cors: { origin: origin.origin }, allowedHosts: [origin.hostname],
      hmr: { host: origin.hostname, protocol: origin.protocol === 'https:' ? 'wss' : 'ws', clientPort: Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)), path: '__hmr' },
      fs: { allow: [root, host, path.resolve(sdk, '..')] },
    },
  })
}
