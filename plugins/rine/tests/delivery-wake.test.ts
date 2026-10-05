import { test, expect } from 'claude-code/testing'
import { at } from './at'
import { allowedRig, receive } from './delivery-kit'

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

test('test_wake_rate_limit_notifies_the_next_message', async () => {
  const rig = allowedRig()
  await receive(rig, 'aaaaaaaa-0001')
  rig.view = { ...rig.view, pendingWake: false }
  await receive(rig, 'aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('toast')).toContain('rine: wake limit reached')
})

test('test_wake_pending_wake_blocks_a_second_wake_and_notifies', async () => {
  const rig = allowedRig()
  await receive(rig, 'aaaaaaaa-0001')
  await receive(rig, 'aaaaaaaa-0002')
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})
