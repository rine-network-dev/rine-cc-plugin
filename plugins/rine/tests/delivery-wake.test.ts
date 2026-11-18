import { test, expect } from 'claude-code/testing'
import { at } from './at'
import { allowedRig, receive, settle, type Rig } from './delivery-kit'

test('test_wake_verified_allowlisted_message_submits_the_wake_text', async () => {
  const rig = allowedRig()
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('submit')[0]).toContain('rine wake')
  expect(rig.kit.sink.textsOf('append')).toEqual([])
  expect(at(rig.view.entries, 0).disposition).toBe('woken')
  expect(rig.view.pendingWake).toBe(true)
  expect(rig.lease.wakeLog).toHaveLength(1)
  expect(rig.woke).toHaveLength(1)
  expect(rig.pinned.map((s) => s.agentId)).toEqual(['agent-bob'])
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('bob@acme.rine.network → you · dm · waking Claude')
})

test('test_wake_dropped_submit_leaves_the_entry_notified_and_charges_no_slot', async () => {
  const rig = allowedRig()
  rig.kit.sink.submitResult = { isDropped: true, reason: 'busy' }
  await receive(rig)
  expect(rig.view.entries[0]).toMatchObject({ disposition: 'notified' })
  expect(at(rig.view.entries, 0).rowIndex).not.toBeNull()
  expect(rig.view.pendingWake).toBe(false)
  expect(rig.lease.wakeLog).toEqual([])
  expect(rig.woke).toEqual([])
  expect(rig.kit.sink.textsOf('toast')).toContain('rine: wake dropped (busy)')
})

test('test_wake_unverified_sender_downgrades_to_notify_with_a_toast', async () => {
  const rig = allowedRig()
  rig.kit.setRun(() => ({ exitCode: 0, stdout: JSON.stringify({ verification_status: 'sender-mismatch', from_agent_id: 'agent-bob' }), stderr: '' }))
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('bob@acme.rine.network → you · dm · not verified, not woken')
})

test('test_wake_failed_read_downgrades_to_notify', async () => {
  const rig = allowedRig()
  rig.kit.setRun(() => ({ exitCode: 1, stdout: '', stderr: '' }))
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(at(rig.view.entries, 0).disposition).toBe('notified')
})

test('test_wake_unknown_permission_mode_notifies_without_reading', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, permissionMode: null }
  await receive(rig)
  expect(rig.kit.runs).toEqual([])
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('rine: not woken until you type a prompt')
})

test('test_wake_bypass_permissions_notifies', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, permissionMode: 'bypassPermissions' }
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('rine: not woken: permissions bypassed')
})

test('test_wake_untrusted_lists_notify_and_say_so_once', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, lists: { ...rig.view.lists, isTrusted: false } }
  await receive(rig, 'aaaaaaaa-0001')
  await receive(rig, 'aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('toast').filter((t) => t === 'rine: lists changed outside /rine')).toHaveLength(1)
})

test('test_wake_read_only_state_notifies', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, identity: { ...rig.view.identity, isStateWritable: false } }
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_wake_non_owner_session_notifies', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, isOwner: false }
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_wake_lease_lost_before_the_wake_notifies', async () => {
  const rig = allowedRig()
  rig.lease.isOwner = false
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

const LIMIT_TOAST = 'rine: wake limit reached'

/** A first wake, then a second message inside the 30 s spacing: its wake is deferred, not lost. */
async function deferSecond(rig: Rig, id = 'aaaaaaaa-0002'): Promise<void> {
  await receive(rig, 'aaaaaaaa-0001')
  rig.view = { ...rig.view, pendingWake: false }
  await receive(rig, id)
}

test('test_wake_rate_limited_message_notifies_then_wakes_once_the_spacing_is_over', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('toast')).toContain(LIMIT_TOAST)
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(2)
  expect(rig.kit.sink.textsOf('submit')[1]).toContain('aaaaaaaa-0002')
  expect(at(rig.view.entries, 1).disposition).toBe('woken')
  expect(rig.lease.wakeLog).toHaveLength(2)
})

test('test_wake_rate_limited_message_read_before_the_spacing_ends_never_wakes', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  rig.view = { ...rig.view, entries: rig.view.entries.map((e) => (e.id === 'aaaaaaaa-0002' ? { ...e, state: 'read' } : e)) }
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
})

test('test_wake_hourly_cap_reached_never_trails_and_keeps_the_toast', async () => {
  const rig = allowedRig()
  const now = await rig.kit.clock.now()
  rig.lease.wakeLog.push(...Array.from({ length: 12 }, (_, i) => now - 40000 - i * 1000))
  await receive(rig)
  await settle(rig)
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('toast')).toContain(LIMIT_TOAST)
})

test('test_wake_rate_limited_message_waits_for_turn_complete_when_the_session_is_busy', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  await rig.delivery.turnStart({})
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  await rig.delivery.turnComplete({ reason: 'answer' })
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(2)
  expect(rig.kit.sink.textsOf('submit')[1]).toContain('aaaaaaaa-0002')
})

test('test_wake_two_rate_limited_messages_share_one_trailing_wake', async () => {
  const rig = allowedRig()
  await deferSecond(rig, 'aaaaaaaa-0002')
  await receive(rig, 'aaaaaaaa-0003')
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(2)
  expect(rig.kit.sink.textsOf('submit')[1]).toContain('aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('submit')[1]).toContain('aaaaaaaa-0003')
})

const UNVERIFIED_TOAST = 'bob@acme.rine.network → you · dm · not verified, not woken'

/** Another wake lands inside the window, so the trailing retry is rate-limited again. */
async function wakeElsewhere(rig: Rig): Promise<void> {
  rig.lease.wakeLog.push(await rig.kit.clock.now())
}

test('test_wake_rate_limited_message_is_told_once_across_retries', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  await wakeElsewhere(rig)
  await settle(rig, 6000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('toast').filter((t) => t === LIMIT_TOAST)).toHaveLength(1)
})

test('test_wake_rate_limited_again_rearms_and_wakes_later_with_one_notify_row', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  await wakeElsewhere(rig)
  await settle(rig, 6000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  await settle(rig, 15000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(2)
  expect(rig.kit.sink.textsOf('submit')[1]).toContain('aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_wake_rate_limited_message_appends_exactly_one_notify_row', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
  await settle(rig)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_wake_retry_that_fails_verification_shows_the_unverified_toast', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  rig.kit.setRun(() => ({ exitCode: 0, stdout: JSON.stringify({ verification_status: 'sender-mismatch', from_agent_id: 'agent-bob' }), stderr: '' }))
  await settle(rig, 15000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('toast')).toContain(UNVERIFIED_TOAST)
})

test('test_wake_message_removed_from_the_allowlist_before_the_timer_never_wakes', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  rig.view = { ...rig.view, lists: { ...rig.view.lists, lists: { allow: [], deny: [] } } }
  await settle(rig, 15000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
})

test('test_wake_rate_limited_message_is_dropped_quietly_when_the_lease_is_lost', async () => {
  const rig = allowedRig()
  await deferSecond(rig)
  const readsBefore = rig.kit.runs.length
  rig.lease.isOwner = false
  await settle(rig, 15000)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  // The retry stops before verification: a lease check missing from the release would read the message.
  expect(rig.kit.runs).toHaveLength(readsBefore)
})

test('test_wake_pending_wake_blocks_a_second_wake_and_notifies', async () => {
  const rig = allowedRig()
  await receive(rig, 'aaaaaaaa-0001')
  await receive(rig, 'aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})
