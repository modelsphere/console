import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('forwards native JSX runtime arguments to the host including static children metadata', async () => {
  const jsx = vi.fn()
  const jsxDEV = vi.fn()
  vi.stubGlobal('__MODELSPHERE_SDK__', { React: { Fragment: Symbol('fragment') }, ReactJSXRuntime: { jsx, jsxs: jsx }, ReactJSXDevRuntime: { jsxDEV } })
  const runtime = await import('../src/react-jsx-runtime-shim')
  expect(runtime.jsx).toBe(jsx)
  expect(runtime.jsxs).toBe(jsx)
  expect(runtime.jsxDEV).toBe(jsxDEV)
})

it('retains createElement fallback for existing Global hosts', async () => {
  const createElement = vi.fn()
  vi.stubGlobal('__RISE_SDK__', { React: { Fragment: Symbol('fragment'), createElement } })
  const runtime = await import('../src/react-jsx-runtime-shim')
  runtime.jsx('div', { children: 'content' }, 'key')
  expect(createElement).toHaveBeenCalledWith('div', { children: 'content', key: 'key' })
})
