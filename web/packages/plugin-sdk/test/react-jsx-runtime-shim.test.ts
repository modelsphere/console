/*
`react/jsx-runtime` shim。

为什么值得测：它是**所有插件共用的基础设施**，而且坏起来很难查 —— jsx 转发写错
不会报错，只会让某个依赖库渲染出错误的树（key 丢了 → 列表 diff 出问题，children
位置错了 → 内容不见）。这些症状离 shim 都很远。
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 装一个假 React，只记录 createElement 收到了什么。 */
function installFakeReact() {
  const createElement = vi.fn((type: any, props: any) => ({ type, props }))
  ;(globalThis as any).__RISE_SDK__ = { React: { createElement, Fragment: Symbol('Fragment') } }
  return createElement
}

describe('react/jsx-runtime shim', () => {
  let createElement: ReturnType<typeof installFakeReact>

  beforeEach(() => {
    vi.resetModules()
    createElement = installFakeReact()
  })
  afterEach(() => {
    delete (globalThis as any).__RISE_SDK__
  })

  it('把 config 原样转给 createElement（children 留在 props 里）', async () => {
    const { jsx } = await import('../src/react-jsx-runtime-shim')
    jsx('div', { className: 'a', children: 'hi' })
    expect(createElement).toHaveBeenCalledWith('div', { className: 'a', children: 'hi' })
  })

  it('第三个参数是 key，要并进 props —— 丢了会让列表 diff 出错', async () => {
    const { jsx } = await import('../src/react-jsx-runtime-shim')
    jsx('li', { children: 'x' }, 'k1')
    expect(createElement).toHaveBeenCalledWith('li', { children: 'x', key: 'k1' })
  })

  it('没有 key 时不要凭空造一个 key 字段', async () => {
    const { jsx } = await import('../src/react-jsx-runtime-shim')
    jsx('div', { children: 'x' })
    const [, props] = createElement.mock.calls[0]
    expect('key' in (props as object)).toBe(false)
  })

  it('jsxs 与 jsx 同语义（差别只是 children 已知是数组）', async () => {
    const { jsx, jsxs } = await import('../src/react-jsx-runtime-shim')
    expect(jsxs).toBe(jsx)
  })

  it('导出 jsxDEV —— 某个库显式 import 时不该炸成 No matching export', async () => {
    const m = await import('../src/react-jsx-runtime-shim')
    expect(typeof m.jsxDEV).toBe('function')
  })

  it('Fragment 取自宿主的 React，不是自造的', async () => {
    const { Fragment } = await import('../src/react-jsx-runtime-shim')
    expect(Fragment).toBe((globalThis as any).__RISE_SDK__.React.Fragment)
  })

  it('宿主没有 React 时当场报错，而不是留一个 undefined 到处传', async () => {
    delete (globalThis as any).__RISE_SDK__
    vi.resetModules()
    await expect(import('../src/react-jsx-runtime-shim')).rejects.toThrow(/React not found/)
  })
})
