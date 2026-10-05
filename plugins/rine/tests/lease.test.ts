import { test, expect } from 'claude-code/testing'
import { seal } from '../hooks/lib/envelope'
import { LEASE_TTL_MS, RENEW_EVERY_MS } from '../hooks/lib/lease'
import { createKit, splice } from './kit'
import { actor, LEASE_PATH as PATH, otherText, put } from './lease-kit'

test('test_acquire_absentFile_ownsAfterReadBack', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  expect(await kit.clock.settle(lease.acquire())).toBe(true)
  expect(lease.isOwner()).toBe(true)
  const read = await lease.read()
  expect(read.status === 'ok' && read.lease.nonce).toBe('aaa')
})

test('test_acquire_twoActorsRace_exactlyOneOwns', async () => {
  const kit = createKit()
  const a = actor(kit, 'aaa')
  const b = actor(kit, 'bbb')
  const [wonA, wonB] = await kit.clock.settle(Promise.all([a.acquire(), b.acquire()]))
  expect([wonA, wonB].filter(Boolean)).toHaveLength(1)
  expect(a.isOwner()).toBe(wonA)
  expect(b.isOwner()).toBe(wonB)
})

test('test_acquire_freshLeaseOfAnother_isNotTaken', async () => {
  const kit = createKit()
  await put(kit, {})
  const lease = actor(kit, 'aaa')
  expect(await kit.clock.settle(lease.acquire())).toBe(false)
  expect(lease.isOwner()).toBe(false)
})

test('test_acquire_staleHeartbeat_isTaken', async () => {
  const kit = createKit()
  await put(kit, { heartbeatAt: 1_000_000 - LEASE_TTL_MS - 1 })
  expect(await kit.clock.settle(actor(kit, 'aaa').acquire())).toBe(true)
})

test('test_acquire_releasedLease_isTaken', async () => {
  const kit = createKit()
  await put(kit, { releasedAt: 1_000_000 })
  expect(await kit.clock.settle(actor(kit, 'aaa').acquire())).toBe(true)
})

test('test_acquire_unknownRead_isFreeOnlyAfterThirtySeconds', async () => {
  const kit = createKit()
  await put(kit, {})
  const torn = splice(kit.fs.files.get(PATH) ?? '', await seal('{"x":1}'))
  kit.fs.files.set(PATH, torn)
  const lease = actor(kit, 'aaa')
  expect(await kit.clock.settle(lease.acquire())).toBe(false)
  await kit.clock.advance(LEASE_TTL_MS)
  expect(await kit.clock.settle(lease.acquire())).toBe(true)
})

test('test_renew_owner_refreshesHeartbeat', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  await kit.clock.advance(RENEW_EVERY_MS)
  const at = await kit.ports.clock.now()
  expect(await kit.clock.settle(lease.renew())).toBe('owned')
  const read = await lease.read()
  expect(read.status === 'ok' && read.lease.heartbeatAt >= at).toBe(true)
})

test('test_renew_anotherNonceOnFile_isLost', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  await put(kit, { nonce: 'bbb' })
  expect(await kit.clock.settle(lease.renew())).toBe('lost')
  expect(lease.isOwner()).toBe(false)
})

test('test_renew_unknownRead_staysOwnedWithoutWriting', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  await kit.clock.settle(lease.acquire())
  const before = kit.fs.files.get(PATH)
  const torn = splice(before ?? '', await seal('{"x":1}'))
  kit.fs.injectReads(PATH, [torn, torn])
  expect(await kit.clock.settle(lease.renew())).toBe('owned')
  expect(kit.fs.files.get(PATH)).toBe(before)
})

test('test_takeover_overwritesAndReadsBackAfterASecond', async () => {
  const kit = createKit()
  await put(kit, {})
  const lease = actor(kit, 'aaa')
  expect(await kit.clock.settle(lease.takeover())).toBe(true)
  expect(lease.isOwner()).toBe(true)
})

test('test_takeover_renewRaceOverwrites_retriesOnce', async () => {
  const kit = createKit()
  await put(kit, {})
  const lease = actor(kit, 'aaa')
  const other = await otherText()
  kit.fs.injectReads(PATH, [other, other, 'x', other])
  expect(await kit.clock.settle(lease.takeover())).toBe(true)
})

test('test_takeover_bothAttemptsLose_isFalse', async () => {
  const kit = createKit()
  const lease = actor(kit, 'aaa')
  const other = await otherText()
  kit.fs.injectReads(PATH, [other, other, other, other, other, other])
  expect(await kit.clock.settle(lease.takeover())).toBe(false)
  expect(lease.isOwner()).toBe(false)
})

