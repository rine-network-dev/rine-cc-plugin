import { test, expect } from 'claude-code/testing'
import { displayHandle, identityHandle } from '../hooks/lib/handle'
import { DISPLAY_HANDLE_VECTORS } from './display-handle-vectors'

for (const v of DISPLAY_HANDLE_VECTORS) {
  test(`test_displayHandle_sharedVector_${v.name}`, async () => {
    expect(displayHandle(v.handle, v.ownSlug)).toBe(v.want)
  })
}

for (const v of DISPLAY_HANDLE_VECTORS.filter((vector) => vector.ownSlug === null)) {
  test(`test_identityHandle_sharedVector_${v.name}`, async () => {
    expect(identityHandle(v.handle)).toBe(v.want)
  })
}

test('test_identityHandle_ownOrgHandle_neverBare', async () => {
  expect(identityHandle('alice@acme.rine.network')).toBe('alice@acme')
})
