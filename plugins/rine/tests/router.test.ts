import { test, expect } from 'claude-code/testing'
import type { RineLists } from '../types/index'
import { gateWake, route, toEntry, type Intent, type RouteContext, type WakeChecks } from '../hooks/lib/router'
import { ALLOW_BOB, message, OWN } from './delivery-kit'

const BOB = { kind: 'agent' as const, handle: 'bob@acme.rine.network', agentId: null }
const lists = (over: Partial<RineLists> = {}): RineLists => ({ allow: [], deny: [], ...over })
const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  ownAgentId: OWN,
  lists: lists(),
  isPreview: false,
  isMuted: false,
  isBacklog: false,
  ...over
})

test('test_route_unlisted_sender_notifies', () => {
  expect(route(message(), ctx()).action).toBe('notify')
})

test('test_route_allowlisted_sender_wakes', () => {
  expect(route(message(), ctx({ lists: ALLOW_BOB })).action).toBe('wake')
})

test('test_route_deny_beats_allow', () => {
  const both = lists({ allow: [BOB], deny: [BOB] })
  expect(route(message(), ctx({ lists: both })).action).toBe('filter')
})

test('test_route_deny_pinned_by_id_after_handle_change_filters', () => {
  const denied = lists({ deny: [{ ...BOB, agentId: 'agent-bob' }] })
  expect(route(message({ senderHandle: 'new@acme.rine.network' }), ctx({ lists: denied })).action).toBe('filter')
})

test('test_route_allow_pinned_to_other_id_notifies_and_names_the_rebound_handle', () => {
  const pinned = lists({ allow: [{ ...BOB, agentId: 'agent-other' }] })
  const intent = route(message(), ctx({ lists: pinned }))
  expect(intent.action).toBe('notify')
  expect(intent.reboundHandle).toBe('bob@acme.rine.network')
})

test('test_route_preview_mode_holds_even_an_allowlisted_sender', () => {
  expect(route(message(), ctx({ lists: ALLOW_BOB, isPreview: true })).action).toBe('hold')
})

test('test_route_preview_mode_still_filters_a_denied_sender', () => {
  expect(route(message(), ctx({ lists: lists({ deny: [BOB] }), isPreview: true })).action).toBe('filter')
})

test('test_route_muted_allowlisted_sender_is_silent', () => {
  expect(route(message(), ctx({ lists: ALLOW_BOB, isMuted: true })).action).toBe('mute')
})

test('test_route_backlog_message_is_counted_not_announced', () => {
  expect(route(message(), ctx({ lists: ALLOW_BOB, isBacklog: true })).action).toBe('backlog')
})

test('test_route_outbound_message_is_dropped', () => {
  expect(route(message({ direction: 'sent' }), ctx()).action).toBe('drop')
})

test('test_route_own_agent_message_is_dropped', () => {
  expect(route(message({ fromAgentId: OWN }), ctx()).action).toBe('drop')
})

test('test_toEntry_dropped_message_leaves_no_entry', () => {
  expect(toEntry(message(), { action: 'drop', list: 'none', reboundHandle: null, isWebhook: false }, 5)).toBeNull()
})

test('test_toEntry_maps_each_action_to_its_disposition', () => {
  const dispositions = (['filter', 'hold', 'backlog', 'mute', 'notify', 'wake'] as const).map(
    (action) => toEntry(message(), { action, list: 'none', reboundHandle: null, isWebhook: false }, 5)?.disposition
  )
  expect(dispositions).toEqual(['silent', 'held', 'backlog', 'silent', 'notified', 'notified'])
})

test('test_toEntry_missing_handle_and_time_fall_back_to_agent_id_and_now', () => {
  const entry = toEntry(message({ senderHandle: null, createdAt: null }), { action: 'notify', list: 'none', reboundHandle: null, isWebhook: false }, 0)
  expect(entry?.from).toBe('agent-bob')
  expect(entry?.createdAt).toBe('1970-01-01T00:00:00.000Z')
  expect(entry?.rowIndex).toBeNull()
})

test('test_toEntry_carriesTheRoutingDecisionsWebhookFlag', () => {
  for (const isWebhook of [true, false]) {
    const intent: Intent = { action: 'notify', list: 'none', reboundHandle: null, isWebhook }
    expect(toEntry(message(), intent, 5)?.isWebhook).toBe(isWebhook)
  }
})

const wakeIntent: Intent = { action: 'wake', list: 'allow', reboundHandle: null, isWebhook: false }
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
  fromAgentId: 'agent-bob',
  ownAgentId: OWN,
  verification: { status: 'verified', fromAgentId: 'agent-bob' },
  ...over
})

test('test_gateWake_all_checks_pass_wakes', () => {
  expect(gateWake(wakeIntent, checks())).toEqual({ kind: 'wake' })
})

test('test_gateWake_before_read_asks_for_verification', () => {
  expect(gateWake(wakeIntent, checks({ verification: null }))).toEqual({ kind: 'verify' })
})

test('test_gateWake_non_wake_intent_notifies', () => {
  expect(gateWake({ ...wakeIntent, action: 'notify' }, checks())).toEqual({ kind: 'notify', reason: 'not-allowlisted' })
})

const failures: Array<[string, Partial<WakeChecks>, string]> = [
  ['denied_since_arrival', { list: 'deny' }, 'denied'],
  ['unlisted_since_arrival', { list: 'none' }, 'not-allowlisted'],
  ['preview_on_since_arrival', { isPreview: true }, 'preview'],
  ['muted_since_arrival', { isMuted: true }, 'muted'],
  ['non_owner', { isOwner: false }, 'not-owner'],
  ['not_interactive', { isInteractive: false }, 'not-interactive'],
  ['state_readonly', { isStateWritable: false }, 'state-readonly'],
  ['lists_untrusted', { isListsTrusted: false }, 'lists-untrusted'],
  ['mode_unknown', { permissionMode: null }, 'mode-unknown'],
  ['bypass_permissions', { permissionMode: 'bypassPermissions' }, 'bypass'],
  ['outbound', { isInbound: false }, 'not-inbound'],
  ['wake_pending', { isPending: true }, 'pending'],
  ['cooldown_active', { cooldownUntil: 2000 }, 'cooldown'],
  ['rate_limited', { isRateAllowed: false }, 'rate-limit'],
  ['unverified_status', { verification: { status: 'invalid', fromAgentId: 'agent-bob' } }, 'unverified'],
  ['sender_mismatch_status', { verification: { status: 'sender-mismatch', fromAgentId: 'agent-bob' } }, 'unverified'],
  ['read_failed', { verification: { status: null, fromAgentId: null } }, 'unverified'],
  ['read_from_another_agent', { verification: { status: 'verified', fromAgentId: 'agent-eve' } }, 'unverified']
]

for (const [name, over, reason] of failures) {
  test(`test_gateWake_${name}_downgrades_to_notify`, () => {
    expect(gateWake(wakeIntent, checks(over))).toEqual({ kind: 'notify', reason })
  })
}

test('test_gateWake_expired_cooldown_wakes', () => {
  expect(gateWake(wakeIntent, checks({ cooldownUntil: 900 }))).toEqual({ kind: 'wake' })
})
