// 「从镜像仓库进入实例创建」URL 契约的单测：三类落点、完整引用与 tag 的
// 一致性、来源/上下文参数的可选性，以及「没有预设参数时不存在任何副作用」。
import { describe, expect, it } from 'vitest'

import {
  CREATE_INSTANCE_ROUTES,
  buildCreateInstanceUrl,
  clearCreateInstanceParams,
  isValidCreateInstancePreset,
  parseCreateInstancePreset,
  splitImageRef,
} from './create-instance'

const REF = '10.126.126.53:30016/team/app:v2'

describe('splitImageRef', () => {
  it('splits a full reference with a port in the registry host', () => {
    expect(splitImageRef(REF)).toEqual({
      registry: '10.126.126.53:30016',
      repository: 'team/app',
      tag: 'v2',
    })
  })

  it('refuses a reference without host, path or tag', () => {
    expect(splitImageRef('host/team/app')).toBeNull()
    expect(splitImageRef('/team/app:v2')).toBeNull()
    expect(splitImageRef('host/:v2')).toBeNull()
    expect(splitImageRef('host/team/app:')).toBeNull()
  })
})

describe('buildCreateInstanceUrl', () => {
  const preset = {
    imageRef: REF,
    tag: 'v2',
    source: 'public' as const,
    namespace: 'team',
    clusterId: 'cluster-a',
  }

  it('builds every target route with the complete reference and tag', () => {
    for (const target of ['container', 'inference', 'application'] as const) {
      const url = buildCreateInstanceUrl(target, preset)
      expect(url.startsWith(`${CREATE_INSTANCE_ROUTES[target]}?`)).toBe(true)
      const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
      expect(query.get('create')).toBe('1')
      expect(query.get('imageRef')).toBe(REF)
      expect(query.get('imageTag')).toBe('v2')
      expect(query.get('imageSource')).toBe('public')
      expect(query.get('namespace')).toBe('team')
      expect(query.get('clusterId')).toBe('cluster-a')
    }
  })

  it('omits provenance and context when they are absent', () => {
    const url = buildCreateInstanceUrl('container', {
      imageRef: REF, tag: 'v2', source: '', namespace: '', clusterId: '',
    })
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
    expect(query.has('imageSource')).toBe(false)
    expect(query.has('namespace')).toBe(false)
    expect(query.has('clusterId')).toBe(false)
  })

  it('refuses a preset whose tag does not match the reference', () => {
    expect(buildCreateInstanceUrl('container', { ...preset, tag: 'v1' })).toBe('')
    expect(buildCreateInstanceUrl('container', { ...preset, imageRef: 'team/app' })).toBe('')
  })
})

describe('parseCreateInstancePreset', () => {
  it('round-trips a built URL', () => {
    const url = buildCreateInstanceUrl('inference', {
      imageRef: REF, tag: 'v2', source: 'hosted', namespace: 'team', clusterId: '',
    })
    expect(parseCreateInstancePreset(url.slice(url.indexOf('?')))).toEqual({
      imageRef: REF,
      tag: 'v2',
      source: 'hosted',
      namespace: 'team',
      clusterId: '',
    })
  })

  it('treats absent, incomplete or inconsistent parameters as no preset', () => {
    expect(parseCreateInstancePreset('')).toBeNull()
    expect(parseCreateInstancePreset('?namespace=team')).toBeNull()
    expect(parseCreateInstancePreset(`?create=1&imageRef=${encodeURIComponent(REF)}`)).toBeNull()
    expect(parseCreateInstancePreset(`?create=1&imageRef=${encodeURIComponent(REF)}&imageTag=v1`)).toBeNull()
    expect(parseCreateInstancePreset('?create=0&imageRef=x%2Fy%3Az&imageTag=z')).toBeNull()
  })

  it('keeps an unknown provenance from invalidating the preset', () => {
    const parsed = parseCreateInstancePreset(`?create=1&imageRef=${encodeURIComponent(REF)}&imageTag=v2&imageSource=mystery`)
    expect(parsed).not.toBeNull()
    expect(parsed!.source).toBe('')
  })
})

describe('isValidCreateInstancePreset', () => {
  it('only accepts a complete reference with the matching tag', () => {
    expect(isValidCreateInstancePreset({ imageRef: REF, tag: 'v2' })).toBe(true)
    expect(isValidCreateInstancePreset({ imageRef: REF, tag: 'v1' })).toBe(false)
    expect(isValidCreateInstancePreset({ imageRef: '', tag: '' })).toBe(false)
  })
})

describe('clearCreateInstanceParams', () => {
  it('removes only the contract parameters and leaves page parameters alone', () => {
    const url = new URL('https://console.example/core.rise.io/v1/tenant/deployments?namespace=team&page=2')
    expect(clearCreateInstanceParams(url)).toBe(false)
    expect(url.searchParams.get('namespace')).toBe('team')
    const presetUrl = new URL(buildCreateInstanceUrl('container', {
      imageRef: REF, tag: 'v2', source: 'public', namespace: 'team', clusterId: '',
    }), 'https://console.example')
    presetUrl.searchParams.set('page', '2')
    expect(clearCreateInstanceParams(presetUrl)).toBe(true)
    expect(presetUrl.searchParams.get('page')).toBe('2')
    expect(presetUrl.searchParams.get('namespace')).toBe('team')
    expect(presetUrl.searchParams.has('create')).toBe(false)
    expect(presetUrl.searchParams.has('imageRef')).toBe(false)
  })
})
