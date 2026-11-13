import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePluginCandidates } from './build'

describe('plugin CSS candidates', () => {
  it('honors source patterns while leaving the default scan unchanged', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'plugin-candidates-'))
    try {
      mkdirSync(path.join(root, 'src'))
      writeFileSync(path.join(root, 'src', 'page.tsx'), '<div className="bg-red-500" />')
      writeFileSync(path.join(root, 'src', 'page.test.mjs'), 'const fixture = "bg-blue-500"')
      const read = () => JSON.parse(readFileSync(path.join(root, 'frontend', 'candidates.json'), 'utf8')) as string[]
      writePluginCandidates({ name: 'test', root })
      expect(read()).toEqual(expect.arrayContaining(['bg-red-500', 'bg-blue-500']))
      writePluginCandidates({ name: 'test', root, cssSourcePatterns: ['**/*.ts', '**/*.tsx'] })
      expect(read()).toContain('bg-red-500')
      expect(read()).not.toContain('bg-blue-500')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
