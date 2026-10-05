import { expect, test } from 'claude-code/testing'
import { heartbeatLine, lifecycleLine, messageLine } from './frame-lines'
import { BAND_PROPS, BOB, MSG_ID, goLive, newWorld, rine, start, streamPhase, until, entriesOf } from './wiring-kit'

test('test_stream_started_spawnsThePersistentStreamWithTheConfigDir', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  expect(world.spawns[0]?.argv).toEqual(['rine', '--json', 'stream', '--persistent', '--heartbeat-timeout', '80'])
  expect(world.spawns[0]?.env).toEqual({ RINE_CONFIG_DIR: '/cfg' })
})

test('test_stream_message_toastsAndShowsInStatusAndBandOnBothSurfaces', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.toasts).toEqual(['bob@acme.rine.network → you · dm'])
  await world.clock.advance(5000)
  expect(world.statuses[world.statuses.length - 1]).toBe('rine ● alice@acme.rine.network · 1 unread')
  const entries = entriesOf(world)
  expect(entries).toHaveLength(1)
  expect(entries?.[0]?.state).toBe('unread')
  expect(entries?.[0]?.from).toBe(BOB)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'rine', surface, component: 'AbovePrompt', props: BAND_PROPS as never })
    expect((await ui.find({ key: 'head' }))?.text).toContain('rine: 1 new — bob@acme.rine.network (dm)')
    await ui.unmount()
  }
})

test('test_stream_messageSplitMidLine_isRejoinedIntoOneToast', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const line = messageLine({ id: MSG_ID })
  world.push(line.slice(0, 40))
  world.push(line.slice(40))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  expect(world.toasts).toHaveLength(1)
  expect(entriesOf(world)).toHaveLength(1)
})

test('test_stream_sameMessageTwice_toastsOnce', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const line = messageLine({ id: MSG_ID })
  world.push(line + line)
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  await world.clock.advance(1000)
  expect(world.toasts).toHaveLength(1)
  expect(entriesOf(world)).toHaveLength(1)
})

test('test_stream_deniedSender_makesNoToast', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, 'deny add bob@acme.rine.network')
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world)?.length === 1, 'the denied entry')
  await world.clock.advance(2000)
  expect(world.toasts).toEqual([])
  expect(entriesOf(world)?.[0]?.list).toBe('deny')
})

test('test_stream_muted_makesNoToastButCountsUnread', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, 'mute')
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => entriesOf(world)?.length === 1, 'the muted entry')
  await world.clock.advance(5000)
  expect(world.toasts).toEqual([])
  expect(world.statuses[world.statuses.length - 1]).toBe('rine ⏸ muted · 1 unread')
})

test('test_stream_backlogBeforeSettle_toastsOneSummary', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  world.push(lifecycleLine('connected'))
  world.push(messageLine({ id: MSG_ID }))
  world.push(heartbeatLine())
  await until(world, () => streamPhase(world) === 'live' && world.toasts.length > 0, 'the backlog summary')
  expect(world.toasts).toEqual(['rine: 1 new while offline, 0 unread from earlier'])
})

test('test_stream_outboundMessage_isDropped', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID, direction: 'sent' }))
  await world.clock.advance(2000)
  expect(world.toasts).toEqual([])
  expect(entriesOf(world) ?? []).toHaveLength(0)
})

test('test_stream_rejectedSessionAppend_isCaughtAndLogged', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.logs.includes('rine: append failed: HooksError'), 'the caught append failure')
  expect(world.toasts).toEqual([`${BOB} → you · dm`])
})
