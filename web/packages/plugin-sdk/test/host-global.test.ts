import { afterEach, expect, it, vi } from 'vitest'
import { getHostSDK, getBusiness } from '../src/host'

afterEach(() => vi.unstubAllGlobals())

it('prefers the ModelSphere host and retains the Global compatibility host', () => {
  const host = { React: {}, business: { console: { marker: 'modelsphere' } } }
  vi.stubGlobal('__MODELSPHERE_SDK__', host)
  vi.stubGlobal('__RISE_SDK__', { React: {}, business: {} })
  expect(getHostSDK()).toBe(host)
  expect(getBusiness()).toBe(host.business)
})
