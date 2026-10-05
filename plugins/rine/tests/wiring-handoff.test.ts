import { expect, test, type Engine } from 'claude-code/testing'
import { MSG_ID, PANE_PROPS, holdMessage, newWorld, until, entriesOf } from './wiring-kit'

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'rine-inbox' })

test('test_preview_paneHandOff_submitsAHandOffWithRineOrigin', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  const ui = await mountPane($)
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.props.key)).toEqual(['row:aaaaaaaa-0001', 'read', 'hand', 'mark', 'preview', 'mute'])
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
