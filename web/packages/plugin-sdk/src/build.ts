import ts from "typescript";
import { sharedImports } from "./shared-imports";
// @modelsphere/plugin-sdk — Build preset for Rise Global UMD plugins
//
// 平台构建约定的唯一实现（freeland#110 封装原则：样板下沉 SDK，插件仓零复制）：
// IIFE 单文件、React 取自宿主 window.__RISE_SDK__（banner + alias 到包内 shim）、
// 产物 frontend/index.umd.js + frontend/candidates.json。插件仓的 tsup.config.ts 只剩：
//
//   import { definePluginConfig } from '@modelsphere/plugin-sdk/build'
//   export default definePluginConfig({ name: 'my-plugin' })
//
// 运行环境是 Node（tsup 配置上下文），不是浏览器 —— 不要从这里 import 浏览器代码。
//
// ── frontend/candidates.json：插件只交「用了哪些类」，宿主一次编译（freeland#176）──
// 插件 UMD 是纯 JS，样式此前完全吃宿主编译好的那份 Tailwind —— 宿主没用过的工具类在
// 插件里写了也不生效、且**静默**。
//
// 第一版修法是每个插件自己产 index.css，当天就翻车：47 份独立构建的样式表拼进一个文档，
// 别的插件的 `.hidden` 排在你的 `.lg:block` 后面就把它压掉了 —— **Tailwind 只保证一份
// 样式表内的规则顺序**，多份表之间没有任何保证。唯一能保证顺序的地方是 Tailwind 自己，
// 所以插件只交候选类清单（用 Tailwind 自己的 oxide 扫描器扫本插件 src/，与 Tailwind
// 构建时看到的一模一样，不是正则近似），宿主 server.js 把所有已安装插件的清单并集**一次**
// 编译成一张 /plugins/_merged.css。插件仓不装 Tailwind、不碰主题：主题 / 变体 / 暗色 /
// 密度全在宿主那一份契约里。

import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Scanner } from '@tailwindcss/oxide'
import { defineConfig, type Options } from 'tsup'

export interface PluginBuildOptions {
  /** 插件名（plugin.yaml 的 name），仅用于日志与排错信息 */
  name: string
  /** 入口文件，默认 src/index.tsx */
  entry?: string
  /** 产物目录，默认 frontend（server.js 热加载与 helm package 都读这里） */
  outDir?: string
  /**
   * 类清单的扫描目录，默认 src。**只扫自己**：扫到别的插件 / node_modules 就等于替别人报类。
   * 传 `false` 关掉 —— 只有确实没有一行 JSX 的纯逻辑插件才该这么做。
   */
  cssSource?: string | false
  /** Glob patterns relative to cssSource. Defaults to all files. */
  cssSourcePatterns?: string[]
  /** 追加/覆盖 tsup 选项（逃生口，慎用 —— 偏离约定的配置应先回到 SDK 讨论） */
  tsup?: Partial<Options>
}

const here = path.dirname(fileURLToPath(import.meta.url))

/** 产物文件名。宿主 `lib/plugin-css.js` 按 entryURL 同目录 + 这个名字取，改名两边一起改。 */
export const CANDIDATES_FILE = 'candidates.json'

/**
 * 从插件根目录的 `Chart.yaml` 读出 `version`，作为 `__PLUGIN_VERSION__` 注入构建产物
 * （project#341）：`createPlugin({ version })` 此前是插件里手写的字面量，没有任何东西
 * 校验它与 Chart.yaml 一致 —— `plugin-chart-guard.yml` 只强制 bump Chart.yaml，不看这个
 * 字面量。实测 2026-09-10：main 上声明了 version 的 49 个插件，48 个与 Chart.yaml 不一致
 * （如 model-x 的 Chart.yaml 已到 0.150.0，前端注册的还是脚手架时的 0.1.0）。
 *
 * 只读顶层 `version:`（Helm chart 版本本来就不加引号，也不允许缩进出现在别的键下），
 * 正则同时兼容裸写和带引号两种写法，防将来有人手滑加引号。
 *
 * ⚠️ **`tsup --watch` 只在启动时读一次**：tsup.config.ts 全程只求值一次，`--watch`
 * 重建的是入口的 JS 依赖图，不会重新执行配置文件，Chart.yaml 也不在那张依赖图里。
 * 本地开发时若在 watcher 跑着的时候手动改 Chart.yaml 的 version，产物里的
 * __PLUGIN_VERSION__ 要重启 watcher 才会更新——跟改 tsup.config.ts 本身要重启一样，
 * 不是本函数独有的限制。CI 每次构建都是全新进程，不受影响。
 */
// 构建期（Node）抛错，只给插件作者看、进不了浏览器，**不国际化**：
// 国际化规范 §1「开发者日志、调试文本和内部诊断不是默认的用户文案」= design spec §4.4 豁免 1。
export function readChartVersion(root: string, pluginName: string): string {
  const file = path.join(root, 'Chart.yaml')
  if (!fs.existsSync(file)) {
    throw new Error(`[plugin-sdk] ${pluginName}: 找不到 ${file} —— 插件版本以 Chart.yaml 的 version 为准`)
  }
  const match = fs.readFileSync(file, 'utf8').match(/^version:\s*['"]?([^'"\s#]+)/m)
  if (!match) {
    throw new Error(`[plugin-sdk] ${pluginName}: ${file} 里没有顶层 version 字段`)
  }
  return match[1]
}

/**
 * 扫描 `<root>/<cssSource>` 里的 Tailwind 候选类 → `<root>/<outDir>/candidates.json`（排序、去重）。
 *
 * 用 `@tailwindcss/oxide` 的 Scanner —— 这就是 Tailwind 构建时用的扫描器，插件源码里能被
 * Tailwind 认出的候选一个不漏、一个不多（此前宿主 safelist 用的正则扫描漏过 cn() 里的
 * 字符串、任意值变体等好几类，见 freeland#176）。清单里会混入不是类的普通单词，无害：
 * 宿主编译时 Tailwind 会忽略认不出的候选。
 *
 * 独立导出：不用 definePluginConfig 的自定义构建也能单独调用。
 */
export function writePluginCandidates(opts: { name: string; root?: string; outDir?: string; cssSource?: string; cssSourcePatterns?: string[] }): string {
  const root = opts.root ?? process.cwd()
  const source = path.resolve(root, opts.cssSource ?? 'src')
  const outDir = path.resolve(root, opts.outDir ?? 'frontend')
  const outFile = path.join(outDir, CANDIDATES_FILE)
  if (!fs.existsSync(source)) {
    throw new Error(`[plugin-sdk] ${opts.name}: 类清单扫描目录不存在 ${source}（传 cssSource 指定，或 cssSource:false 关闭）`)
  }
  const scanner = new Scanner({ sources: (opts.cssSourcePatterns ?? ['**/*']).map(pattern => ({ base: source, pattern, negated: false })) })
  const candidates = [...new Set(scanner.scan())].sort()
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(candidates) + '\n')
  console.log(`[plugin-sdk] ${opts.name}: ${path.relative(root, outFile)} ${candidates.length} candidates`)
  return outFile
}

const sharedReactOptions: NonNullable<Options['esbuildOptions']> = (options) => {
  const shim = path.join(here, 'react-shim.mjs')
  const jsxShim = path.join(here, 'react-jsx-runtime-shim.mjs')
  options.jsx = 'transform'
  options.jsxFactory = 'React.createElement'
  options.jsxFragment = 'React.Fragment'
  options.alias = {
    ...(options.alias ?? {}),
    'react/jsx-runtime': jsxShim,
    'react/jsx-dev-runtime': jsxShim,
    react: shim,
    'react-dom': shim,
  }
}

export function definePluginConfig(opts: PluginBuildOptions) {
  const outDir = opts.outDir ?? 'frontend'
  const root = process.cwd()
  const chartVersion = readChartVersion(root, opts.name)
  const userOnSuccess = opts.tsup?.onSuccess
  const { define: userDefine, ...restTsupOverrides } = opts.tsup ?? {}
  return defineConfig({
    entry: { 'index.umd': opts.entry ?? 'src/index.tsx' },
    format: ['iife'],
    platform: 'browser',
    outDir,
    outExtension: () => ({ js: '.js' }),
    minify: true,
    external: [],
    banner: {
      js: 'var React = (window.__MODELSPHERE_SDK__ || window.__GLOBAL_SDK__ || window.__RISE_SDK__).React;',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __PLUGIN_VERSION__: JSON.stringify(chartVersion),
      ...userDefine,
    },
    esbuildOptions: sharedReactOptions,
    ...restTsupOverrides,
    esbuildPlugins: [sharedImports(path.resolve(root, opts.cssSource || 'src'), ts), ...(opts.tsup?.esbuildPlugins ?? [])],
    async onSuccess() {
      if (opts.cssSource !== false) {
        writePluginCandidates({ name: opts.name, outDir, cssSource: opts.cssSource, cssSourcePatterns: opts.cssSourcePatterns })
      }
      if (typeof userOnSuccess === 'function') return userOnSuccess()
      if (typeof userOnSuccess === 'string') {
        execFileSync(userOnSuccess, { shell: true, stdio: 'inherit' })
      }
    },
  })
}
