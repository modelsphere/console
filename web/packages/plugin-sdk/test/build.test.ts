import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readChartVersion } from '../src/build'

// definePluginConfig 本身要在 tsup 配置上下文里跑（依赖 tsup 的 defineConfig），
// 这里只测它新增的、能独立验证的那部分：从 Chart.yaml 读版本号。
// project#341：这个值此前是插件里手写的字面量，49 个插件里 48 个跟 Chart.yaml 对不上。

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function writeChart(content: string): string {
  dir = mkdtempSync(path.join(tmpdir(), 'plugin-sdk-chart-'))
  writeFileSync(path.join(dir, 'Chart.yaml'), content)
  return dir
}

describe('readChartVersion', () => {
  it('读出裸写的 version', () => {
    const root = writeChart('apiVersion: v2\nname: rise-plugin-demo\nversion: 0.1.151\n')
    expect(readChartVersion(root, 'demo')).toBe('0.1.151')
  })

  it('读出带引号的 version（防将来手滑加引号）', () => {
    const root = writeChart('apiVersion: v2\nversion: "1.2.3"\n')
    expect(readChartVersion(root, 'demo')).toBe('1.2.3')
  })

  it('忽略行内注释', () => {
    const root = writeChart('apiVersion: v2\nversion: 0.2.0 # bumped for foo\n')
    expect(readChartVersion(root, 'demo')).toBe('0.2.0')
  })

  it('不会被别的键下面缩进的 version 骗到（如 dependencies 列表里的子 chart 版本）', () => {
    const root = writeChart(
      'apiVersion: v2\n' +
        'dependencies:\n' +
        '  - name: sub\n' +
        '    version: 9.9.9\n' +
        'version: 0.1.0\n',
    )
    expect(readChartVersion(root, 'demo')).toBe('0.1.0')
  })

  it('Chart.yaml 不存在时抛出明确错误', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'plugin-sdk-chart-'))
    expect(() => readChartVersion(dir!, 'demo')).toThrow(/找不到.*Chart\.yaml/)
  })

  it('Chart.yaml 里没有 version 字段时抛出明确错误', () => {
    const root = writeChart('apiVersion: v2\nname: rise-plugin-demo\n')
    expect(() => readChartVersion(root, 'demo')).toThrow(/没有顶层 version/)
  })
})
