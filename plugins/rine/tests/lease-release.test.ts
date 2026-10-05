import { test, expect } from 'claude-code/testing'
import { isWakeAllowed, newNonce, WAKES_PER_HOUR, WAKE_SPACING_MS } from '../hooks/lib/lease'
import { createKit } from './kit'
import { actor, LEASE_PATH as PATH, put } from './lease-kit'

test('test_release_owner_writesReleasedAtInOneWrite', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  const at = await kit.ports.clock.now()
  await lease.release()
  const read = await actor(kit, 'bbb').read()
  expect(read.status === 'ok' && read.lease.releasedAt).toBe(at)
  expect(lease.isOwner()).toBe(false)
})

test('test_release_nonceNotOurs_leavesTheFileAlone', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  await put(kit, { nonce: 'bbb' })
  const before = kit.fs.files.get(PATH)
  await lease.release()
  expect(kit.fs.files.get(PATH)).toBe(before)
})

test('test_isStillOwner_showsOurNonce_untilAnotherWrites', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  expect(await lease.isStillOwner()).toBe(true)
  await put(kit, { nonce: 'bbb' })
  expect(await lease.isStillOwner()).toBe(false)
})

test('test_wakes_carryOverToTheNextOwner', async () => {
  const kit = createKit()
  const first = actor(kit, 'aaa')
  await kit.clock.settle(first.acquire())
  await kit.clock.settle(first.recordWake(1_000_100))
  await kit.clock.settle(first.renew())
  await first.release()
  const second = actor(kit, 'bbb')
  await kit.clock.settle(second.acquire())
  expect(second.wakes()).toEqual([1_000_100])
})

test('test_contend_freeLease_acquiresAfterJitter', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  expect(await kit.clock.settle(lease.contend())).toBe(true)
})

test('test_contend_heldLease_isFalse', async () => {
  const kit = createKit()
  await put(kit, {})
  expect(await kit.clock.settle(actor(kit, 'aaa').contend())).toBe(false)
})

test('test_isWakeAllowed_spacingAndHourlyCap', () => {
  const now = 100_000_000
  expect(isWakeAllowed([], now)).toBe(true)
  expect(isWakeAllowed([now - WAKE_SPACING_MS + 1], now)).toBe(false)
  expect(isWakeAllowed([now - WAKE_SPACING_MS], now)).toBe(true)
  const full = Array.from({ length: WAKES_PER_HOUR }, (_, i) => now - 60_000 - i * 60_000)
  expect(isWakeAllowed(full, now)).toBe(false)
  expect(isWakeAllowed(full.slice(1), now)).toBe(true)
})

test('test_newNonce_isThirtyTwoHexAndVaries', () => {
  const kit = createKit()
  const one = newNonce(kit.ports.random)
  expect(one).toMatch(/^[0-9a-f]{32}$/)
  expect(newNonce(kit.ports.random)).not.toBe(one)
})


test('test_recordWake_isOnFileAtOnce_withoutARenewOrARelease', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  await kit.clock.settle(lease.recordWake(1_000_100))
  const read = await actor(kit, 'bbb').read()
  expect(read.status === 'ok' && read.lease.wakes).toEqual([1_000_100])
})
