import { test, expect } from 'claude-code/testing'
import { ABORT_COOLDOWN_MS } from '../hooks/lib/delivery-wake'
import { at } from './at'
import { allowedRig, message, receive, settle } from './delivery-kit'

test('test_wake_busy_session_gets_a_notify_row_and_no_wake', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

test('test_wake_unseen_row_wakes_when_the_turn_ends_with_an_answer', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  await rig.delivery.turnComplete({ reason: 'answer' })
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
  expect(rig.view.isBusy).toBe(false)
})

test('test_wake_row_the_model_saw_does_not_wake_after_the_turn', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  rig.delivery.turnStep({ messageCount: 1 })
  await rig.delivery.turnComplete({ reason: 'answer' })
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_wake_row_beyond_the_request_still_wakes', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  rig.delivery.turnStep({ messageCount: 0 })
  await rig.delivery.turnComplete({ reason: 'answer' })
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
})

test('test_wake_subagent_turn_events_are_ignored', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  rig.delivery.turnStep({ agentId: 'sub-1', messageCount: 9 })
  await rig.delivery.turnStart({ agentId: 'sub-1' })
  await rig.delivery.turnComplete({ agentId: 'sub-1', reason: 'aborted' })
  expect(rig.view.isBusy).toBe(true)
  expect(rig.view.wakeCooldownUntil).toBeNull()
  await rig.delivery.turnComplete({ reason: 'answer' })
  await settle(rig)
  expect(rig.kit.sink.textsOf('submit')).toHaveLength(1)
})

test('test_wake_aborted_turn_sets_a_five_minute_cooldown_and_does_not_wake', async () => {
  const rig = allowedRig()
  await rig.delivery.turnStart({})
  await receive(rig)
  const now = await rig.kit.ports.clock.now()
  await rig.delivery.turnComplete({ reason: 'aborted' })
  await settle(rig)
  expect(rig.view.wakeCooldownUntil).toBe(now + ABORT_COOLDOWN_MS)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})

test('test_wake_message_during_the_cooldown_notifies', async () => {
  const rig = allowedRig()
  rig.view = { ...rig.view, wakeCooldownUntil: (await rig.kit.ports.clock.now()) + 60_000 }
  await receive(rig)
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
  expect(rig.kit.sink.textsOf('append')).toHaveLength(1)
})

for (const reason of ['error', 'refusal'] as const) {
  test(`test_wake_${reason}_turn_leaves_the_unseen_row_notified`, async () => {
    const rig = allowedRig()
    await rig.delivery.turnStart({})
    await receive(rig)
    await rig.delivery.turnComplete({ reason })
    await settle(rig)
    expect(rig.kit.sink.textsOf('submit')).toEqual([])
    expect(at(rig.view.entries, 0).disposition).toBe('notified')
  })
}

test('test_wake_two_simultaneous_arrivals_spend_one_wake_slot', async () => {
  const rig = allowedRig()
  await Promise.all([rig.delivery.onMessage(message({ id: 'aaaaaaaa-0001' }), false), rig.delivery.onMessage(message({ id: 'aaaaaaaa-0002' }), false)])
  await settle(rig)
  expect(rig.lease.wakeLog.length).toBe(1)
})

test('test_wake_a_throwing_sink_is_caught_and_logged', async () => {
  const rig = allowedRig()
  rig.kit.ports.sink.submit = async () => {
    throw new Error('boom')
  }
  await receive(rig)
  expect(rig.logs.length).toBeGreaterThan(0)
  expect(rig.view.pendingWake).toBe(true)
})
