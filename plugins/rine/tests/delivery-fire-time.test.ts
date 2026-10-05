import { test, expect } from 'claude-code/testing'
import { MAX_TURNS_AHEAD_OF_WAKE } from '../hooks/lib/delivery-wake'
import { at } from './at'
import { allowedRig, message, READ_OK, receive, settle, type Rig } from './delivery-kit'

type Change = (rig: Rig) => void

const DENY_BOB = { allow: [], deny: [{ kind: 'agent' as const, handle: 'bob@acme.rine.network', agentId: null }] }
const CHANGES: [string, Change, string, number][] = [
  ['muted', (rig) => void (rig.view = { ...rig.view, isMuted: true }), 'silent', 0],
  ['denied', (rig) => void (rig.view = { ...rig.view, lists: { ...rig.view.lists, lists: DENY_BOB } }), 'silent', 0],
  ['preview', (rig) => void (rig.view = { ...rig.view, isPreview: true }), 'held', 0],
  ['unlisted', (rig) => void (rig.view = { ...rig.view, lists: { ...rig.view.lists, lists: { allow: [], deny: [] } } }), 'notified', 1]
]

/** The change lands while the wake's read is in flight, after the arrival-time decision. */
function changeDuringTheRead(rig: Rig, change: Change): void {
  rig.kit.setRun(() => {
    change(rig)
    return { exitCode: 0, stdout: READ_OK, stderr: '' }
  })
}

for (const [name, change, disposition, rows] of CHANGES) {
  test(`test_wake_${name}_after_arrival_does_not_wake_on_the_idle_path`, async () => {
    const rig = allowedRig()
    changeDuringTheRead(rig, change)
    await receive(rig)
    expect(rig.kit.sink.textsOf('submit')).toEqual([])
    expect(rig.kit.sink.textsOf('append')).toHaveLength(rows)
    expect(at(rig.view.entries, 0).disposition).toBe(disposition)
    expect(rig.lease.wakeLog).toEqual([])
  })

  test(`test_wake_${name}_after_arrival_does_not_wake_when_the_busy_turn_ends`, async () => {
    const rig = allowedRig()
    await rig.delivery.turnStart({})
    await receive(rig)
    change(rig)
    await rig.delivery.turnComplete({ reason: 'answer' })
    await settle(rig)
    expect(rig.kit.sink.textsOf('submit')).toEqual([])
    expect(at(rig.view.entries, 0).disposition).toBe(disposition)
  })
}

test('test_wake_complete_of_a_turn_that_ran_before_the_wake_leaves_the_wake_pending_until_its_own_turn_ends', async () => {
  const rig = allowedRig()
  await receive(rig)
  expect(rig.view.pendingWake).toBe(true)
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(true)
  await rig.delivery.turnStart({ text: rig.kit.sink.textsOf('submit')[0] })
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(false)
})

test('test_wake_dropped_submit_clears_the_awaiting_wake_so_the_next_turn_end_clears_pending', async () => {
  const rig = allowedRig()
  rig.kit.sink.submitResult = { isDropped: true, reason: 'busy' }
  await receive(rig)
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(false)
})

test('test_wake_turnStartOfAQueuedHumanTurn_doesNotClearTheAwaitedWake', async () => {
  const rig = allowedRig()
  await receive(rig)
  await rig.delivery.turnStart({ text: 'typed by the person while the wake waited' })
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(true)
  await rig.delivery.turnStart({ text: rig.kit.sink.textsOf('submit')[0] })
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(false)
})

test('test_wake_muteLandingDuringASiblingsRead_stopsTheAlreadyCheckedCandidate', async () => {
  const rig = allowedRig()
  const unverified = JSON.stringify({ verification_status: 'failed', from_agent_id: 'agent-bob', decrypted_payload: { text: 'x' } })
  let reads = 0
  rig.kit.setRun(() => {
    reads += 1
    if (reads === 1) {
      void rig.delivery.onMessage(message({ id: 'aaaaaaaa-0002' }), false)
      void rig.delivery.onMessage(message({ id: 'aaaaaaaa-0003' }), false)
      return { exitCode: 0, stdout: unverified, stderr: '' }
    }
    if (reads === 3) rig.view = { ...rig.view, isMuted: true }
    return { exitCode: 0, stdout: READ_OK, stderr: '' }
  })
  await receive(rig)
  expect(reads).toBe(3)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.lease.wakeLog).toEqual([])
  expect(rig.view.entries.find((entry) => entry.id === 'aaaaaaaa-0002')?.disposition).toBe('silent')
})

test('test_wake_rewrittenByAnotherPlugin_itsOwnTurnStillClearsTheAwaitedWake', async () => {
  const rig = allowedRig()
  rig.kit.sink.submitResult = { isDropped: false, entered: '[house style] rewritten wake' }
  await receive(rig)
  await rig.delivery.turnStart({ text: '[house style] rewritten wake' })
  await rig.delivery.turnComplete({ reason: 'answer' })
  expect(rig.view.pendingWake).toBe(false)
})

test('test_wake_ownTurnNeverMatched_givesUpAfterTheBoundSoPendingWakeClears', async () => {
  const rig = allowedRig()
  await receive(rig)
  for (let turn = 1; turn <= MAX_TURNS_AHEAD_OF_WAKE + 1; turn += 1) {
    await rig.delivery.turnStart({ text: `queued prompt ${turn}` })
    await rig.delivery.turnComplete({ reason: 'answer' })
    expect(rig.view.pendingWake).toBe(turn <= MAX_TURNS_AHEAD_OF_WAKE)
  }
})

test('test_wake_entryReadDuringASiblingsRead_isLeftOutOfTheWake', async () => {
  const rig = allowedRig()
  const unverified = JSON.stringify({ verification_status: 'failed', from_agent_id: 'agent-bob', decrypted_payload: { text: 'x' } })
  let reads = 0
  rig.kit.setRun(() => {
    reads += 1
    if (reads === 1) {
      void rig.delivery.onMessage(message({ id: 'aaaaaaaa-0002' }), false)
      void rig.delivery.onMessage(message({ id: 'aaaaaaaa-0003' }), false)
      return { exitCode: 0, stdout: unverified, stderr: '' }
    }
    if (reads === 3) {
      const entries = rig.view.entries.map((entry) => (entry.id === 'aaaaaaaa-0002' ? { ...entry, state: 'read' as const } : entry))
      rig.view = { ...rig.view, entries }
    }
    return { exitCode: 0, stdout: READ_OK, stderr: '' }
  })
  await receive(rig)
  const submitted = rig.kit.sink.textsOf('submit')
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('aaaaaaaa-0003')
  expect(submitted[0]).not.toContain('aaaaaaaa-0002')
})
