import { test, expect } from 'claude-code/testing'
import type { StreamMessage } from '../hooks/lib/frames'
import type { DeliveryView } from '../hooks/lib/delivery-core'
import { allowedRig, createRig, message, OWN, READ_OK, settle, type Rig } from './delivery-kit'

const OWN_HANDLE = 'me@acme.rine.network'
const ALLOW_OWN = { allow: [{ kind: 'agent' as const, handle: OWN_HANDLE, agentId: null }], deny: [] }
const ownRig = (over: Partial<DeliveryView> = {}) => createRig({ lists: { lists: ALLOW_OWN, digest: null, isTrusted: true }, ...over })

const webhook = (over: Partial<StreamMessage> = {}): StreamMessage =>
  message({ type: 'rine.v1.webhook', fromAgentId: OWN, senderHandle: OWN_HANDLE, direction: 'sent', ...over })

const VERIFIED_OWN = JSON.stringify({ verification_status: 'verified', from_agent_id: OWN, decrypted_payload: { text: 'ping' } })
const answer = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

async function deliver(rig: Rig, msg: StreamMessage, isBacklog = false): Promise<void> {
  await rig.delivery.onMessage(msg, isBacklog)
  await settle(rig)
}

test('test_webhook_verified_own_sent_wakes', async () => {
  const rig = ownRig()
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('submit')[0]).toContain('[rine wake:')
  expect(rig.kit.sink.textsOf('submit')[0]).toContain('outside HTTP caller')
  expect(rig.view.entries[0]?.disposition).toBe('woken')
  expect(rig.pinned).toEqual([])
  expect(rig.lease.wakeLog).toHaveLength(1)
  expect(rig.kit.runs).toHaveLength(1)
})

test('test_webhook_verified_own_received_wakes', async () => {
  const rig = ownRig()
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook({ direction: 'received' }))
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
})

test('test_webhook_sender_mismatch_notifies', async () => {
  const rig = ownRig()
  rig.kit.setRun(() => answer(JSON.stringify({ verification_status: 'sender-mismatch', from_agent_id: OWN })))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('notified')
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_webhook_verified_foreign_id_notifies', async () => {
  const rig = ownRig()
  rig.kit.setRun(() => answer(JSON.stringify({ verification_status: 'verified', from_agent_id: 'agent-bob' })))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('notified')
})

test('test_webhook_failed_read_notifies', async () => {
  const rig = ownRig()
  rig.kit.setRun(() => ({ exitCode: 1, stdout: '', stderr: '' }))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_webhook_muted_is_silent', async () => {
  const rig = createRig({ isMuted: true })
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toEqual([])
})

test('test_webhook_preview_is_held', async () => {
  const rig = createRig({ isPreview: true })
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('held')
})

test('test_webhook_backlog_is_backlog', async () => {
  const rig = createRig()
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook(), true)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('backlog')
})

test('test_webhook_bypass_permissions_notifies', async () => {
  const rig = ownRig({ permissionMode: 'bypassPermissions' })
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_webhook_non_owner_notifies', async () => {
  const rig = ownRig({ isOwner: false })
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_webhook_not_allowlisted_notifies_without_reading', async () => {
  const rig = createRig()
  rig.kit.setRun(() => answer(VERIFIED_OWN))
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('notified')
  expect(rig.kit.runs).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')[0]).toContain('addressed from your own agent to itself')
})

test('test_webhook_own_handle_denied_is_filtered', async () => {
  const rig = createRig({ lists: { lists: { allow: ALLOW_OWN.allow, deny: [{ kind: 'agent' as const, handle: OWN_HANDLE, agentId: null }] }, digest: null, isTrusted: true } })
  await deliver(rig, webhook())
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('silent')
})

test('test_webhook_foreign_sender_allowlisted_wakes_with_the_allowlist_header', async () => {
  const rig = allowedRig()
  rig.kit.setRun(() => answer(READ_OK))
  await deliver(rig, message({ type: 'rine.v1.webhook', direction: 'received' }))
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('submit')[0]).toContain("New rine messages from senders on the user's wake allowlist")
  expect(rig.kit.sink.textsOf('submit')[0]).not.toContain('addressed from your own agent to itself')
})

test('test_webhook_foreign_sender_notifies_without_reading', async () => {
  const rig = createRig()
  await deliver(rig, message({ type: 'rine.v1.webhook', direction: 'received' }))
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries[0]?.disposition).toBe('notified')
  expect(rig.kit.runs).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
  expect(rig.kit.sink.textsOf('append')[0]).not.toContain('addressed from your own agent to itself')
})

test('test_webhook_ordinary_own_message_is_dropped', async () => {
  const rig = createRig()
  await deliver(rig, message({ fromAgentId: OWN, senderHandle: null, direction: 'received' }))
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.view.entries).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toEqual([])
})
