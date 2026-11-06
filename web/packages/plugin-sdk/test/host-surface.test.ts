// 宿主注入面的访问器与守卫（freeland#2060）：
// - getUi / getBusiness 读 window.__RISE_SDK__.ui / .business，宿主未就绪时返回空对象；usePermissions 转发宿主 hook。
// - 本包不含业务组件：src/ 下没有 business/，入口不导出业务组件名与已移除的 getComponents（业务组件只在 rise-global
//   @theriseunion/business，插件经 getBusiness() 取用）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SDK from '../src/index'
import { getBusiness, getUi, usePermissions } from '../src/host'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src')
const host = globalThis as { __RISE_SDK__?: unknown }

afterEach(() => { delete host.__RISE_SDK__ })

describe('访问器', () => {
  it('getUi / getBusiness 返回宿主注入的对应面（同一引用）', () => {
    const ui = { Button: () => null }
    const business = { SpecSelect: () => null }
    host.__RISE_SDK__ = { ui, business }
    expect(getUi()).toBe(ui)
    expect(getBusiness()).toBe(business)
  })

  it('宿主未就绪或缺面时返回空对象，不抛', () => {
    expect(getUi()).toEqual({})
    expect(getBusiness()).toEqual({})
    host.__RISE_SDK__ = {}
    expect(getUi()).toEqual({})
    expect(getBusiness()).toEqual({})
  })

  it('usePermissions 转发宿主 hook 并原样返回', () => {
    const value = { hasPermission: () => true, loading: false }
    const hook = vi.fn(() => value)
    host.__RISE_SDK__ = { usePermissions: hook }
    expect(usePermissions()).toBe(value)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('宿主没有 usePermissions 时抛出带名字的错误', () => {
    host.__RISE_SDK__ = {}
    expect(() => usePermissions()).toThrow(/usePermissions is not provided by the host/)
  })
})

describe('守卫：本包不含业务组件', () => {
  const BUSINESS = [
    'WorkspaceSelect', 'ProjectSelect', 'ClusterSelect', 'SpecSelect', 'SpecSelectView', 'PoolSelect', 'PoolSelectView',
    'ImageSelect', 'ImageSelectView', 'useFlavorChoices', 'useImageChoices', 'flavorChoicesErrorText', 'prepareImagePullSecrets',
    'fetchNamespaces', 'fetchPlatformRepos', 'fetchTags', 'preparePublicRepository', 'imageRefOf', 'mergeFilter',
    'repositoriesForArch', 'repositoriesMatchingFilter', 'tagOptionsOf', 'toggleFacet', 'versionsForArch',
  ]

  it('src/ 下没有 business/ 目录', () => {
    expect(existsSync(join(SRC, 'business'))).toBe(false)
  })

  it('入口不导出业务组件名与 getComponents', () => {
    const exported = Object.keys(SDK)
    expect(exported.filter(n => BUSINESS.includes(n) || n === 'getComponents')).toEqual([])
    expect(exported).toEqual(expect.arrayContaining(['getUi', 'getBusiness', 'usePermissions']))
  })

  it('源码不引用 @theriseunion/*（发布产物不能依赖消费方装不到的包）', () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const f of ['index.ts', 'host.ts', 'types.ts']) {
      expect(code(readFileSync(join(SRC, f), 'utf8')), f).not.toMatch(/from\s+['"]@theriseunion\//)
    }
  })
})
