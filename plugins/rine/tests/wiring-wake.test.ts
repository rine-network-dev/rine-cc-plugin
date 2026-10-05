import { expect, test, type Engine } from 'claude-code/testing'
import { BOB, MSG_ID, OWN_HANDLE, OWN_ID, VERIFIED_BOB, goLive, newWorld, rine, start, until, type World, entriesOf } from './wiring-kit'
import { messageLine } from './frame-lines'

/** A live, allowlisted session whose `rine read` verifies bob: the state every wake case starts from. */
async function ready($: Engine, world: World): Promise<void> {
  world.readAnswer.value = VERIFIED_BOB
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${BOB}`)
}

test('test_wake_allowedVerifiedSenderAfterAPrompt_submitsAWakeWithRineOrigin', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.submits.length > 0, 'a wake submit')
  expect(world.submits).toHaveLength(1)
  expect(world.submits[0]?.text.startsWith('[rine wake: started by the rine plugin')).toBe(true)
  expect(world.submits[0]?.text).toContain(MSG_ID)
  expect(world.submits[0]?.origin).toEqual({ kind: 'plugin', name: 'rine' })
  await until(world, () => entriesOf(world)[0]?.disposition === 'woken', 'the entry to be marked woken')
  expect(entriesOf(world)).toHaveLength(1)
})

test('test_wake_beforeAnyPrompt_toastsNotWokenUntilYouType', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'a toast')
  expect(world.toasts).toEqual(['rine: not woken until you type a prompt'])
  expect(world.submits).toEqual([])
})

test('test_wake_underBypassPermissions_isNotWokenAndToasts', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'bypassPermissions' } as never)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'a toast')
  expect(world.toasts).toEqual(['rine: not woken: permissions bypassed'])
  expect(world.submits).toEqual([])
})

test('test_wake_unverifiedRead_doesNotSubmit', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  world.readAnswer.value = null
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'a toast')
  expect(world.submits).toEqual([])
  expect(world.toasts[0]?.endsWith('not verified, not woken')).toBe(true)
})

test('test_wake_duringATurn_waitsForTheTurnToComplete', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  await $.turn.start({ text: 'work', turnId: 't1' } as never)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world).length === 1, 'the entry')
  await world.clock.advance(2000)
  expect(world.submits).toEqual([])
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await until(world, () => world.submits.length > 0, 'the wake after the turn')
  expect(world.submits[0]?.text.startsWith('[rine wake:')).toBe(true)
})

test('test_wake_subagentTurnComplete_isIgnored', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  await $.turn.start({ text: 'work', turnId: 't1' } as never)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world).length === 1, 'the entry')
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'sub' } as never)
  await world.clock.advance(5000)
  expect(world.submits).toEqual([])
})

test('test_wake_submitDropped_toastsAndLeavesNoWake', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.submitDrop = { reason: 'busy' }
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'a toast')
  expect(world.toasts).toEqual(['rine: wake dropped (busy)'])
  expect(world.submits).toHaveLength(1)
  expect(entriesOf(world)[0]?.disposition).toBe('notified')
})

const OWN_WEBHOOK = { id: MSG_ID, type: 'rine.v1.webhook', from_agent_id: OWN_ID, sender_handle: OWN_HANDLE, direction: 'sent' }

test('test_wake_selfAddressedWebhook_wakesOnceTheOwnHandleIsAllowlisted', async ($, on) => {
  const world = newWorld(on)
  world.readAnswer.value = JSON.stringify({ verification_status: 'verified', from_agent_id: OWN_ID, decrypted_payload: { text: 'build failed' } })
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${OWN_HANDLE}`)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine(OWN_WEBHOOK))
  await until(world, () => world.submits.length > 0, 'a wake submit')
  expect(world.submits[0]?.text.startsWith('[rine wake: started by the rine plugin')).toBe(true)
  expect(world.submits[0]?.text).toContain('addressed from your own agent to itself')
})

test('test_wake_selfAddressedWebhook_notAllowlisted_isNotifiedNotWoken', async ($, on) => {
  const world = newWorld(on)
  world.readAnswer.value = JSON.stringify({ verification_status: 'verified', from_agent_id: OWN_ID, decrypted_payload: { text: 'build failed' } })
  await start($, world)
  await goLive(world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine(OWN_WEBHOOK))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.submits).toEqual([])
  expect(entriesOf(world)[0]?.disposition).toBe('notified')
})

test('test_wake_foreignWebhook_isNotifiedNotWoken', async ($, on) => {
  const world = newWorld(on)
  world.readAnswer.value = VERIFIED_BOB
  await start($, world)
  await goLive(world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine({ id: MSG_ID, type: 'rine.v1.webhook' }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.submits).toEqual([])
  expect(entriesOf(world)[0]?.disposition).toBe('notified')
  expect(entriesOf(world)[0]?.isWebhook).toBe(false)
})

test('test_wake_foreignWebhookFromAllowlistedSender_wakesWithTheAllowlistHeader', async ($, on) => {
  const world = newWorld(on)
  await ready($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  world.push(messageLine({ id: MSG_ID, type: 'rine.v1.webhook' }))
  await until(world, () => world.submits.length > 0, 'a wake submit')
  expect(world.submits[0]?.text).toContain("senders on the user's wake allowlist")
  expect(world.submits[0]?.text).not.toContain('addressed from your own agent to itself')
})
