import { expect, test } from 'claude-code/testing'
import { messageLine } from './frame-lines'
import { BAND_PROPS, BOB, MSG_ID, goLive, holdMessage, newWorld, rine, start, until, entriesOf } from './wiring-kit'

test('test_preview_on_holdsAnAllowedMessageWithoutWaking', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  expect(world.toasts).toEqual([`${BOB} → you · dm · held for review`])
  expect(entriesOf(world)[0]?.disposition).toBe('held')
  expect(world.submits).toEqual([])
  await until(world, () => world.state.has(`preview:${MSG_ID}`), 'the decrypted preview')
  expect(world.state.get(`preview:${MSG_ID}`)).toEqual({ status: 'ok', text: 'hello there', isVerified: true, hiddenChars: 0, truncatedChars: 0 })
})

test('test_preview_heldMessage_bandShowsReviewWithoutHand', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'rine', surface, component: 'AbovePrompt', props: BAND_PROPS as never })
    expect((await ui.find({ key: 'head' }))?.text).toContain('rine: 1 new — bob@acme.rine.network (dm)')
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.props.label)).toEqual(['Review', 'Mark read', 'Mute 1h'])
    await ui.unmount()
  }
})

test('test_preview_off_isAnnouncedAndNewMessagesNotifyAgain', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, 'preview on')
  const off = (await rine($, world, 'preview off')) as { text: string }
  expect(off.text.startsWith('preview off')).toBe(true)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.toasts).toEqual([`${BOB} → you · dm`])
})

test('test_preview_composerOnlyCommand_isRefusedFromAPluginOrigin', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const refused = (await rine($, world, 'preview on', { kind: 'plugin' })) as { text: string }
  expect(refused).toEqual({ text: '/rine preview is for the user to run at the keyboard.' })
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.toasts).toEqual([`${BOB} → you · dm`])
})
