import { expect, test } from 'claude-code/testing'
import { seal } from '../hooks/lib/envelope'
import { pathOf } from './wiring-files'
import { BOB, PANE_PROPS, goLive, newWorld, rine, start, type World } from './wiring-kit'


const outsideEdit = async (world: World): Promise<void> => {
  world.files.set(pathOf('lists'), await seal(JSON.stringify({ v: 1, allow: [{ kind: 'agent', handle: 'eve@x.rine.network', agentId: null }], deny: [] })))
  await world.clock.advance(5000)
  await world.clock.advance(5000)
}

test('test_origin_mutatingCommandsFromAPluginOrigin_areRefusedAndWriteNothing', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const listsBefore = world.files.get(pathOf('lists'))
  const prefsBefore = world.files.get(pathOf('prefs'))
  for (const args of ['mute', 'unmute', 'preview on', `allow add ${BOB}`, `deny add ${BOB}`, 'takeover']) {
    const answer = (await rine($, world, args, { kind: 'plugin' })) as { text: string }
    expect(answer).toEqual({ text: `/rine ${args.split(' ')[0]} is for the user to run at the keyboard.` })
  }
  expect(world.files.get(pathOf('lists'))).toBe(listsBefore)
  expect(world.files.get(pathOf('prefs'))).toBe(prefsBefore)
})

test('test_origin_bridgeOrigin_isRefusedToo', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = (await rine($, world, 'mute', { kind: 'bridge' })) as { text: string }
  expect(answer).toEqual({ text: '/rine mute is for the user to run at the keyboard.' })
})

test('test_origin_readOnlyRowFromAPluginOrigin_stillAnswers', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = (await rine($, world, 'allow list', { kind: 'plugin' })) as { text: string }
  expect(answer).toEqual({ text: 'allow list (0): empty' })
})

test('test_trust_listsEditedOutsideRine_toastAndWakeOffUntilConfirmed', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${BOB}`)
  await outsideEdit(world)
  expect(world.toasts).toContain('rine: lists changed outside /rine; review them in the inbox pane (wake is off until you confirm)')
  expect(world.state.get('isListsTrusted')).toBe(false)
  expect(world.state.get('lists')).toEqual({ allow: [{ kind: 'agent', handle: 'eve@x.rine.network', agentId: null }], deny: [] })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'rine-inbox' })
  expect(await ui.find({ key: 'confirm' })).toBeDefined()
  await ui.press({ key: 'confirm' } as never)
  await world.clock.advance(1000)
  expect(world.state.get('isListsTrusted')).toBe(true)
  await ui.unmount()
})

test('test_trust_untrustedAllowList_isNotedInTheListText', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${BOB}`)
  await outsideEdit(world)
  const answer = (await rine($, world, 'allow list')) as { text: string }
  expect(answer).toEqual({ text: 'allow list (1): eve@x.rine.network (changed outside /rine: review in the inbox pane before it wakes Claude)' })
})
