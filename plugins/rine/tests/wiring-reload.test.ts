import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { digestHex, seal } from '../hooks/lib/envelope'
import { bodyOf, pathOf, type LeaseBody } from './wiring-files'
import { BOB, OWN_ID, T0, begin, entriesOf, newWorld, start, streamPhase, until, type World } from './wiring-kit'

const NONCE = 'n'.repeat(32)
const SEEDED_ENTRY = { id: 'aaaaaaaa-0009', from: BOB, fromAgentId: 'agent-b', group: null, groupId: null, type: 'rine.v1.dm', conversationId: 'c', encryption: 'hpke-hybrid-v2', createdAt: '2026-10-02T09:00:00Z', receivedAt: T0 - 60000, list: 'allow', disposition: 'notified', state: 'unread', rowIndex: null }
const lease = (over: Record<string, unknown> = {}) => ({ nonce: NONCE, agentId: OWN_ID, sessionId: 'session-0', cwd: '/proj', heartbeatAt: T0 - 5000, releasedAt: null, wakes: [T0 - 100000], ...over })
const ledger = { v: 1, entries: [SEEDED_ENTRY], appliedRequests: [] }
const sealed = (value: unknown): Promise<string> => seal(JSON.stringify(value))
const VOLATILE = { stream: { phase: 'live', attempt: 0, lastFrameAt: T0, nextRetryAt: null, ownerCwd: null, unreadable: 0 }, isOwner: true, pendingWake: true }
const STATE = { entries: [SEEDED_ENTRY], leaseNonce: NONCE, mirrorSince: T0 - 90000, ...VOLATILE }
const STATE_NO_NONCE = { entries: [SEEDED_ENTRY], mirrorSince: T0 - 90000, ...VOLATILE }

/** The state files a previous run left behind: a sealed lease and a sealed ledger. */
const prior = async (over: Record<string, unknown> = {}): Promise<Record<string, string>> => ({ [pathOf('lease')]: await sealed(lease(over)), [pathOf('ledger')]: await sealed(ledger) })

/** A fresh world seeded with what the previous run left in the files, `$.state` and `$.store`; the session starts and the first 3 s pass. */
async function reloaded($: Engine, on: On, files: Record<string, string>, state: Record<string, unknown>, store?: Record<string, unknown>): Promise<World> {
  const world = newWorld(on, { files, state, store })
  await start($, world)
  await world.clock.advance(3000)
  return world
}

const listsFile = async (): Promise<{ body: string; files: Record<string, string> }> => {
  const body = JSON.stringify({ v: 1, allow: [{ kind: 'agent', handle: BOB, agentId: null }], deny: [] })
  return { body, files: { ...(await prior()), [pathOf('lists')]: await seal(body) } }
}

test('test_reload_priorLedger_staysInTheEntriesAndTheFile', async ($, on) => {
  const world = await reloaded($, on, await prior(), STATE)
  expect(entriesOf(world).map((entry) => entry.id)).toEqual(['aaaaaaaa-0009'])
  expect(world.files.get(pathOf('ledger'))).toContain('aaaaaaaa-0009')
})

test('test_reload_priorLease_keepsTheNonceAndTheWakeLog', async ($, on) => {
  const world = await reloaded($, on, await prior(), STATE)
  const body = bodyOf<LeaseBody>(world, 'lease')
  expect(body.nonce).toBe(NONCE)
  expect(body.sessionId).toBe('session-1')
  expect(body.releasedAt).toBeNull()
  expect(body.wakes).toEqual([T0 - 100000])
})

test('test_reload_staleVolatileState_isResetBeforeTheStreamStarts', async ($, on) => {
  const world = await reloaded($, on, await prior(), STATE)
  expect(world.state.get('isOwner')).toBe(true)
  expect(world.state.get('pendingWake')).toBe(false)
  expect(world.state.get('stream')).toEqual({ phase: 'connecting', attempt: 0, lastFrameAt: null, nextRetryAt: null, ownerCwd: null, unreadable: 0 })
})

test('test_reload_mirrorBaseline_isKept', async ($, on) => {
  const world = await reloaded($, on, await prior(), STATE)
  expect(world.state.get('mirrorSince')).toBe(T0 - 90000)
  expect(world.state.get('leaseNonce')).toBe(NONCE)
})

test('test_reload_leaseHeldByAnotherLiveSession_makesThisOneAPeer', async ($, on) => {
  const world = newWorld(on, { files: await prior({ nonce: 'z'.repeat(32), sessionId: 'other', heartbeatAt: T0 - 1000 }), state: STATE_NO_NONCE })
  await begin($, world)
  await until(world, () => streamPhase(world) === 'peer', 'the peer phase')
  expect(world.spawns).toEqual([])
  expect(world.state.get('isOwner')).toBe(false)
})

test('test_reload_releasedLease_isTakenOverBySpawningTheStream', async ($, on) => {
  const world = await reloaded($, on, await prior({ nonce: 'z'.repeat(32), releasedAt: T0 - 1000 }), STATE_NO_NONCE)
  expect(world.spawns.length).toBeGreaterThan(0)
  expect(bodyOf<LeaseBody>(world, 'lease').nonce).not.toBe('z'.repeat(32))
})

test('test_reload_trustDigestInTheStore_keepsTheListsTrusted', async ($, on) => {
  const { body, files } = await listsFile()
  const world = await reloaded($, on, files, STATE, { [`lists-trust:${OWN_ID}:/cfg`]: [await digestHex(body)] })
  expect(world.state.get('isListsTrusted')).toBe(true)
  expect(world.toasts).toEqual([])
})

test('test_reload_noTrustDigestForAListsFile_startsUntrustedAndToasts', async ($, on) => {
  const world = await reloaded($, on, (await listsFile()).files, STATE)
  expect(world.state.get('isListsTrusted')).toBe(false)
  expect(world.toasts).toEqual(['rine: lists changed outside /rine; review them in the inbox pane (wake is off until you confirm)'])
})
