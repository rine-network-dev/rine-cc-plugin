import { test, expect } from 'claude-code/testing'
import { humanTime } from '../hooks/lib/human-time'
import { HUMAN_TIME_VECTORS } from './human-time-vectors'

test('test_humanTime_sharedVectors_runInUtc', async () => {
  // The test sandbox has no `process` and pins UTC, so only the UTC vectors can run here; the other zones
  // run in rine-core's own suite against the same source file.
  expect(new Date(0).getTimezoneOffset()).toBe(0)
})

for (const v of HUMAN_TIME_VECTORS.filter((vector) => vector.tz === 'UTC')) {
  test(`test_humanTime_sharedVector_${v.name}`, async () => {
    expect(humanTime(v.iso, v.nowMs)).toBe(v.want)
    expect(Array.from(v.want).length).toBeLessThanOrEqual(9)
  })
}
