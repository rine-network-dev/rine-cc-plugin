import { test, expect } from 'claude-code/testing'
import { ORG_ACK_KEY, acknowledgeOrg, isOrgAcknowledged, type OrgAckStore } from '../hooks/lib/org-ack'

function memoryStore(seed?: unknown) {
  const kept = new Map<string, unknown>(seed === undefined ? [] : [[ORG_ACK_KEY, seed]])
  const saves: Array<[string, unknown]> = []
  const store: OrgAckStore = {
    load: async (key) => kept.get(key),
    save: async (key, value) => {
      saves.push([key, value])
      kept.set(key, value)
    }
  }
  return { store, saves }
}

test('test_isOrgAcknowledged_missingValue_isFalse', async () => {
  expect(await isOrgAcknowledged(memoryStore().store)).toBe(false)
})

test('test_isOrgAcknowledged_malformedValue_isFalse', async () => {
  for (const bad of [{ v: 2 }, 'yes', null, 1, {}]) {
    expect(await isOrgAcknowledged(memoryStore(bad).store)).toBe(false)
  }
})

test('test_isOrgAcknowledged_validValue_isTrue', async () => {
  expect(await isOrgAcknowledged(memoryStore({ v: 1 }).store)).toBe(true)
})

test('test_acknowledgeOrg_writesVersionOneUnderKey_andReadsBack', async () => {
  const kit = memoryStore()
  await acknowledgeOrg(kit.store)
  expect(kit.saves).toEqual([['orgTabAck', { v: 1 }]])
  expect(await isOrgAcknowledged(kit.store)).toBe(true)
})
