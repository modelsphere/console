import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { HOST_SURFACES, sharedNames } from './shared-imports'

export function developmentSharedModules(root: string, directory: string) {
  const source = path.join(root, 'src')
  const files = Object.fromEntries(Object.keys(HOST_SURFACES).map(name => [name, path.join(directory, name.split('/').join('-') + '.mjs')]))
  function refresh() {
    const names = sharedNames(source, ts)
    const changed: string[] = []
    for (const [name, surface] of Object.entries(HOST_SURFACES)) {
      const exports = [...names[name]].sort().map(key => `export const ${key}=shared.${key};`).join('\n')
      const contents = `const shared=(window.__MODELSPHERE_SDK__ || window.__GLOBAL_SDK__ || window.__RISE_SDK__).${surface};\n${exports}\n`
      if (!fs.existsSync(files[name]) || fs.readFileSync(files[name], 'utf8') !== contents) {
        fs.writeFileSync(files[name], contents)
        changed.push(files[name])
      }
    }
    return changed
  }
  refresh()
  const plugin: Plugin = {
    name: 'modelsphere-development-shared-modules',
    handleHotUpdate(context) {
      if (!context.file.startsWith(source + path.sep) || !/\.tsx?$/.test(context.file)) return
      for (const file of refresh()) {
        for (const module of context.server.moduleGraph.getModulesByFile(file) ?? []) {
          context.server.moduleGraph.invalidateModule(module, new Set(), context.timestamp, true)
        }
      }
      // Page imports get fresh shim URLs; shared exports still refer to host singletons.
      return context.modules
    },
  }
  const aliases = Object.entries(files).map(([name, replacement]) => ({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement }))
  return { aliases, plugin }
}
