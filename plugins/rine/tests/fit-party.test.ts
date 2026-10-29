import { test, expect } from 'claude-code/testing'
import { fitFromTo, fitGroupSender, fitHandle } from '../hooks/lib/fit-party'
import { FIT_PARTY_VECTORS } from './fit-party-vectors'

for (const v of FIT_PARTY_VECTORS.handle) {
  test(`test_fitHandle_sharedVector_${v.name}`, async () => {
    expect(fitHandle(v.label, v.cells)).toBe(v.want)
  })
}

for (const v of FIT_PARTY_VECTORS.group) {
  test(`test_fitGroupSender_sharedVector_${v.name}`, async () => {
    expect(fitGroupSender(v.group, v.sender, v.room)).toEqual(v.want)
  })
}

for (const v of FIT_PARTY_VECTORS.pair) {
  test(`test_fitFromTo_sharedVector_${v.name}`, async () => {
    expect(fitFromTo(v.from, v.to, v.room)).toEqual(v.want)
  })
}
