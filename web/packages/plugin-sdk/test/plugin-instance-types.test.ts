import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('消费者仍可使用标准注入面，但旧句柄字段和类型不再可引用', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = mkdtempSync(join(root, '.instance-type-contract-'))
  const file = join(dir, 'consumer.ts')
  writeFileSync(file, `
    import { getUi, getBusiness } from '../src/index'
    import type { PluginInstance } from '../src/index'
    // @ts-expect-error 4.0 删除旧公开类型。
    import type { PluginUI } from '../src/index'
    declare const plugin: PluginInstance
    // @ts-expect-error 4.0 删除旧句柄字段。
    plugin.ui
    plugin.api
    plugin.events
    plugin.nav
    getUi().ConfirmDialog
    getBusiness().SpecSelect
  `)
  try {
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true,
      strict: true, noEmit: true, esModuleInterop: true,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
