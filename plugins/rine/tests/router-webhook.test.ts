import { test, expect } from 'claude-code/testing'
import type { RineLists } from '../types/index'
import type { StreamMessage } from '../hooks/lib/frames'
import { gateWake, route, type Intent, type RouteContext, type WakeChecks } from '../hooks/lib/router'
import { message, OWN } from './delivery-kit'

const OWN_HANDLE = 'me@acme.rine.network'
const lists = (over: Partial<RineLists> = {}): RineLists => ({ allow: [], deny: [], ...over })
const allowOwn = lists({ allow: [{ kind: 'agent', handle: OWN_HANDLE, agentId: null }] })
const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  ownAgentId: OWN,
  lists: lists(),
  isPreview: false,
  isMuted: false,
  isBacklog: false,
  ...over
})
const webhook = (over: Partial<StreamMessage> = {}): StreamMessage =>
  message({ type: 'rine.v1.webhook', fromAgentId: OWN, senderHandle: null, direction: 'sent', ...over })
const ownWebhook = (over: Partial<StreamMessage> = {}): StreamMessage => webhook({ senderHandle: OWN_HANDLE, ...over })

test('test_route_own_webhook_not_allowlisted_notifies', () => {
  const intent = route(ownWebhook(), ctx())
  expect(intent.action).toBe('notify')
  expect(intent.isWebhook).toBe(true)
})

test('test_route_own_webhook_with_own_handle_allowlisted_wakes', () => {
  const intent = route(ownWebhook(), ctx({ lists: allowOwn }))
  expect(intent.action).toBe('wake')
  expect(intent.isWebhook).toBe(true)
})

test('test_route_own_webhook_received_wakes', () => {
  expect(route(ownWebhook({ direction: 'received' }), ctx({ lists: allowOwn })).action).toBe('wake')
})

test('test_route_own_webhook_in_preview_holds', () => {
  expect(route(webhook(), ctx({ isPreview: true })).action).toBe('hold')
})

test('test_route_own_webhook_in_backlog_is_counted', () => {
  expect(route(webhook(), ctx({ isBacklog: true })).action).toBe('backlog')
})

test('test_route_own_webhook_muted_is_silent', () => {
  expect(route(webhook(), ctx({ isMuted: true })).action).toBe('mute')
})

test('test_route_own_webhook_denied_by_own_id_filters', () => {
  const denied = lists({ deny: [{ kind: 'agent', handle: 'me@acme.rine.network', agentId: OWN }] })
  expect(route(webhook(), ctx({ lists: denied })).action).toBe('filter')
})

test('test_route_own_webhook_with_own_handle_denied_filters', () => {
  const denied = lists({ allow: allowOwn.allow, deny: [{ kind: 'agent', handle: OWN_HANDLE, agentId: null }] })
  expect(route(ownWebhook(), ctx({ lists: denied })).action).toBe('filter')
})

test('test_route_foreign_webhook_notifies', () => {
  expect(route(webhook({ fromAgentId: 'agent-bob', direction: 'received' }), ctx()).action).toBe('notify')
})

test('test_route_foreign_webhook_unlisted_notifies', () => {
  const allow = lists({ allow: [{ kind: 'agent', handle: 'other@acme.rine.network', agentId: null }] })
  expect(route(webhook({ fromAgentId: 'agent-bob', direction: 'received' }), ctx({ lists: allow })).action).toBe('notify')
})

test('test_route_foreign_webhook_from_allowlisted_sender_wakes_and_is_not_a_self_webhook', () => {
  const allow = lists({ allow: [{ kind: 'agent', handle: 'bob@acme.rine.network', agentId: null }] })
  const frame = webhook({ fromAgentId: 'agent-bob', senderHandle: 'bob@acme.rine.network', direction: 'received' })
  const intent = route(frame, ctx({ lists: allow }))
  expect(intent.action).toBe('wake')
  expect(intent.isWebhook).toBe(false)
})

test('test_route_ordinary_own_message_is_dropped', () => {
  expect(route(message({ type: 'rine.v1.dm', fromAgentId: OWN }), ctx()).action).toBe('drop')
})

test('test_route_own_webhook_less_outbound_message_is_dropped', () => {
  expect(route(message({ direction: 'sent' }), ctx()).action).toBe('drop')
})

const wakeIntent: Intent = { action: 'wake', list: 'allow', reboundHandle: null, isWebhook: true }
const plainWakeIntent: Intent = { ...wakeIntent, isWebhook: false }
const checks = (over: Partial<WakeChecks> = {}): WakeChecks => ({
  list: 'allow',
  isMuted: false,
  isPreview: false,
  isOwner: true,
  isInteractive: true,
  isStateWritable: true,
  isListsTrusted: true,
  permissionMode: 'default',
  isInbound: true,
  isPending: false,
  cooldownUntil: null,
  now: 1000,
  isRateAllowed: true,
  fromAgentId: OWN,
  ownAgentId: OWN,
  verification: { status: 'verified', fromAgentId: OWN },
  ...over
})

test('test_gateWake_webhook_allowlisted_wakes', () => {
  expect(gateWake(wakeIntent, checks())).toEqual({ kind: 'wake' })
})

test('test_gateWake_webhook_not_allowlisted_notifies', () => {
  expect(gateWake(wakeIntent, checks({ list: 'none' }))).toEqual({ kind: 'notify', reason: 'not-allowlisted' })
})

test('test_gateWake_webhook_before_read_asks_for_verification', () => {
  expect(gateWake(wakeIntent, checks({ verification: null }))).toEqual({ kind: 'verify' })
})

test('test_gateWake_webhook_denied_since_arrival_notifies', () => {
  expect(gateWake(wakeIntent, checks({ list: 'deny' }))).toEqual({ kind: 'notify', reason: 'denied' })
})

const failures: Array<[string, Partial<WakeChecks>, string]> = [
  ['preview_on_since_arrival', { isPreview: true }, 'preview'],
  ['muted_since_arrival', { isMuted: true }, 'muted'],
  ['non_owner', { isOwner: false }, 'not-owner'],
  ['not_interactive', { isInteractive: false }, 'not-interactive'],
  ['state_readonly', { isStateWritable: false }, 'state-readonly'],
  ['lists_untrusted', { isListsTrusted: false }, 'lists-untrusted'],
  ['mode_unknown', { permissionMode: null }, 'mode-unknown'],
  ['bypass_permissions', { permissionMode: 'bypassPermissions' }, 'bypass'],
  ['wake_pending', { isPending: true }, 'pending'],
  ['cooldown_active', { cooldownUntil: 2000 }, 'cooldown'],
  ['rate_limited', { isRateAllowed: false }, 'rate-limit']
]

for (const [name, over, reason] of failures) {
  test(`test_gateWake_webhook_${name}_downgrades_to_notify`, () => {
    expect(gateWake(wakeIntent, checks(over))).toEqual({ kind: 'notify', reason })
  })
}

const unverified: Array<[string, Partial<WakeChecks>]> = [
  ['invalid_status', { verification: { status: 'invalid', fromAgentId: OWN } }],
  ['read_answered_for_another_agent', { verification: { status: 'verified', fromAgentId: 'agent-bob' } }],
  ['frame_disagrees_with_read', { fromAgentId: 'agent-bob', verification: { status: 'verified', fromAgentId: OWN } }],
  ['read_answered_for_an_agent_that_is_no_longer_this_one', { fromAgentId: 'agent-old', verification: { status: 'verified', fromAgentId: 'agent-old' } }],
  ['read_failed', { verification: { status: null, fromAgentId: null } }]
]

for (const [name, over] of unverified) {
  test(`test_gateWake_webhook_${name}_notifies_unverified`, () => {
    expect(gateWake(wakeIntent, checks(over))).toEqual({ kind: 'notify', reason: 'unverified' })
  })
}

test('test_gateWake_non_webhook_allowlisted_sender_wakes', () => {
  const over = { list: 'allow' as const, fromAgentId: 'agent-bob', verification: { status: 'verified', fromAgentId: 'agent-bob' } }
  expect(gateWake(plainWakeIntent, checks(over))).toEqual({ kind: 'wake' })
})

test('test_gateWake_non_webhook_unlisted_sender_notifies', () => {
  expect(gateWake(plainWakeIntent, checks({ list: 'none' }))).toEqual({ kind: 'notify', reason: 'not-allowlisted' })
})
