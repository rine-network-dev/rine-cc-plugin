import { test, expect } from 'claude-code/testing'
import { at } from './at'
import { makeEntry } from './entry-kit'
import { ALLOW_BOB, createRig, message, settle } from './delivery-kit'

test('test_delivery_unlisted_message_appends_one_notify_row_and_records_its_index', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')[0]).toContain('1 new rine message, not read yet')
  expect(rig.view.entries[0]).toMatchObject({ disposition: 'notified', rowIndex: 1 })
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_delivery_notify_raises_a_toast_and_a_notice', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  await settle(rig)
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('bob@acme.rine.network → you · dm')
  expect(rig.kit.sink.textsOf('notice')[0]).toBe('rine: 1 new message from bob@acme.rine.network (dm)')
})

test('test_delivery_burst_collapses_into_one_batch_toast_and_notice', async () => {
  const rig = createRig()
  for (const id of ['aaaaaaaa-0001', 'aaaaaaaa-0002', 'aaaaaaaa-0003']) await rig.delivery.onMessage(message({ id }), false)
  await settle(rig)
  expect(rig.kit.sink.textsOf('toast')).toHaveLength(2)
  expect(rig.kit.sink.textsOf('toast')[1]).toBe('rine: 2 more from 1 sender')
  expect(rig.kit.sink.textsOf('notice')[1]).toBe('rine: 2 new messages from 1 sender')
})

test('test_delivery_duplicate_message_id_is_recorded_once', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  await rig.delivery.onMessage(message(), false)
  expect(rig.view.entries).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_delivery_own_and_outbound_messages_leave_no_trace', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message({ direction: 'sent' }), false)
  await rig.delivery.onMessage(message({ id: 'aaaaaaaa-0002', fromAgentId: 'agent-own' }), false)
  expect(rig.view.entries).toEqual([])
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_denied_sender_is_recorded_silently', async () => {
  const rig = createRig({ lists: { lists: { allow: [], deny: [{ kind: 'agent', handle: 'bob@acme.rine.network', agentId: null }] }, digest: null, isTrusted: true } })
  await rig.delivery.onMessage(message(), false)
  await settle(rig)
  expect(at(rig.view.entries, 0).disposition).toBe('silent')
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_muted_message_is_recorded_without_a_row_or_toast', async () => {
  const rig = createRig({ isMuted: true })
  await rig.delivery.onMessage(message(), false)
  await settle(rig)
  expect(at(rig.view.entries, 0).disposition).toBe('silent')
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_rebound_handle_adds_a_warning_toast', async () => {
  const rig = createRig({ lists: { lists: { allow: [{ kind: 'agent', handle: 'bob@acme.rine.network', agentId: 'agent-other' }], deny: [] }, digest: null, isTrusted: true } })
  await rig.delivery.onMessage(message(), false)
  expect(rig.kit.sink.textsOf('toast')).toContain('rine: bob@acme.rine.network is now a different agent')
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_delivery_refused_append_leaves_the_entry_notified_without_a_row_index', async () => {
  const rig = createRig()
  rig.kit.sink.isAppendFailing = true
  await rig.delivery.onMessage(message(), false)
  expect(rig.view.entries[0]).toMatchObject({ disposition: 'notified', rowIndex: null })
})

test('test_delivery_preview_mode_holds_toasts_and_loads_the_preview', async () => {
  const rig = createRig({ isPreview: true, lists: { lists: ALLOW_BOB, digest: null, isTrusted: true } })
  await rig.delivery.onMessage(message(), false)
  await settle(rig)
  expect(at(rig.view.entries, 0).disposition).toBe('held')
  expect(rig.kit.sink.textsOf('toast')[0]).toBe('bob@acme.rine.network → you · dm · held for review')
  expect(rig.kit.sink.textsOf('append')).toEqual([])
  expect(rig.previews.get('aaaaaaaa-0001')).toMatchObject({ status: 'ok', text: 'hello', isVerified: true })
  expect(rig.kit.runs).toEqual([['rine', '--json', 'read', 'aaaaaaaa-0001']])
})

test('test_delivery_preview_mode_with_read_only_state_loads_nothing', async () => {
  const rig = createRig({ isPreview: true })
  rig.view = { ...rig.view, identity: { ...rig.view.identity, isStateWritable: false } }
  await rig.delivery.onMessage(message(), false)
  await settle(rig)
  expect(rig.kit.runs).toEqual([])
  expect(rig.previews.size).toBe(0)
})

test('test_delivery_backlog_message_is_counted_only', async () => {
  const rig = createRig({ lists: { lists: ALLOW_BOB, digest: null, isTrusted: true } })
  await rig.delivery.onMessage(message(), true)
  expect(at(rig.view.entries, 0).disposition).toBe('backlog')
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_settled_reports_the_backlog_once_with_a_summary', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), true)
  rig.carried.add('older')
  rig.view = { ...rig.view, entries: [...rig.view.entries, makeEntry({ id: 'older' })] }
  await rig.delivery.onSettled()
  expect(rig.kit.sink.textsOf('toast')).toEqual(['rine: 1 new while offline, 1 unread from earlier'])
  expect(rig.kit.sink.textsOf('append')[0]).toContain('1 rine message arrived while no session was connected; 1 more are unread')
})

test('test_delivery_settled_with_nothing_to_report_says_nothing', async () => {
  const rig = createRig()
  await rig.delivery.onSettled()
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_settled_while_muted_says_nothing', async () => {
  const rig = createRig({ isMuted: true })
  await rig.delivery.onMessage(message(), true)
  await rig.delivery.onSettled()
  expect(rig.kit.sink.calls).toEqual([])
})

test('test_delivery_announce_appends_notify_rows_in_chunks_of_twenty', async () => {
  const rig = createRig()
  const entries = Array.from({ length: 21 }, (_, i) => makeEntry({ id: `m-${i}` }))
  await rig.delivery.announce(entries)
  expect(rig.kit.sink.textsOf('append')).toHaveLength(2)
})

test('test_delivery_announce_is_silent_in_preview_mode', async () => {
  const rig = createRig({ isPreview: true })
  await rig.delivery.announce([makeEntry()])
  expect(rig.kit.sink.calls).toEqual([])
})
