import { expect, test, type Engine } from 'claude-code/testing'
import { makeEntry } from './entry-kit'
import { messageLine } from './frame-lines'
import { BAND_PROPS, MSG_ID, T0, PANE_PROPS, VERIFIED_BOB, goLive, holdMessage, newWorld, start, until, entriesOf } from './wiring-kit'

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'rine-inbox' })

test('test_preview_paneHandOff_submitsAHandOffWithRineOrigin', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.props.key)).toEqual(['row:aaaaaaaa-0001', 'read', 'hand', 'mark', 'preview', 'mute', 'org'])
  await ui.press({ key: 'row:aaaaaaaa-0001' } as never)
  await ui.press({ key: 'hand' } as never)
  await until(world, () => world.submits.length > 0, 'the hand-off submit')
  expect(world.submits).toHaveLength(1)
  expect(world.submits[0]?.text.startsWith('[rine hand-off: the user selected these messages for you in the rine inbox]')).toBe(true)
  expect(world.submits[0]?.text).toContain(MSG_ID)
  expect(world.submits[0]?.origin).toEqual({ kind: 'plugin', name: 'rine' })
  await world.clock.advance(1500)
  expect(entriesOf(world)[0]?.disposition).toBe('handed')
  await ui.unmount()
})

test('test_preview_paneHandOff_duringATurn_submitsAndToastsQueued', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await $.classic.UserPromptSubmit({ prompt: 'work', permission_mode: 'default' } as never)
  await $.turn.start({ text: 'work', turnId: 't1' } as never)
  const ui = await mountPane($)
  await ui.press({ key: 'row:aaaaaaaa-0001' } as never)
  await ui.press({ key: 'hand' } as never)
  await until(world, () => world.toasts.includes('rine: queued for Claude'), 'the queued toast')
  expect(world.submits).toHaveLength(1)
  expect(world.submits[0]?.text.startsWith('[rine hand-off:')).toBe(true)
  await ui.unmount()
})

test('test_band_handPress_handsOnlyTheEntriesTheBandShowed', async ($, on) => {
  const world = newWorld(on)
  world.readAnswer.value = VERIFIED_BOB
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world).length === 1, 'the first arrival')
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  const band = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  // An arrival the drawn band never listed: written beneath the engine, so no redraw runs before the press.
  world.state.set('entries', [...entriesOf(world), makeEntry({ id: 'bbbbbbbb-0002', receivedAt: T0 })])
  await band.press({ key: 'hand' } as never)
  await until(world, () => world.submits.length > 0, 'the hand-off submit')
  expect(world.submits[0]?.text).toContain(MSG_ID)
  expect(world.submits[0]?.text).not.toContain('bbbbbbbb-0002')
  await world.clock.advance(1500)
  const late = entriesOf(world).find((entry) => entry.id === 'bbbbbbbb-0002')
  expect(late?.disposition).not.toBe('handed')
  expect(world.state.get('foldedIds')).toEqual([MSG_ID])
  await band.unmount()
})

test('test_band_handPress_afterAFold_handsOnlyTheArrivalAndFoldsEverythingListed', async ($, on) => {
  const world = newWorld(on)
  world.readAnswer.value = VERIFIED_BOB
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world).length === 1, 'the first arrival')
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  const first = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  await first.press({ key: 'later' } as never)
  await first.unmount()
  world.push(messageLine({ id: 'bbbbbbbb-0002' }))
  await until(world, () => entriesOf(world).length === 2, 'the second arrival')
  const band = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  await band.press({ key: 'hand' } as never)
  await until(world, () => world.submits.length > 0, 'the hand-off submit')
  expect(world.submits[0]?.text).toContain('bbbbbbbb-0002')
  expect(world.submits[0]?.text).not.toContain(MSG_ID)
  expect(world.state.get('foldedIds')).toEqual([MSG_ID, 'bbbbbbbb-0002'])
  await band.unmount()
})
