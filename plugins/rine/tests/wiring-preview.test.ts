import { expect, test } from 'claude-code/testing'
import { messageLine } from './frame-lines'
import { BAND_PROPS, BOB, MSG_ID, PANE_PROPS, goLive, holdMessage, newWorld, rine, start, until, entriesOf, type World } from './wiring-kit'

const previewRead = (world: World) => until(world, () => (world.state.get(`preview:${MSG_ID}`) as { status?: string } | undefined)?.status === 'ok', 'the decrypted preview')

test('test_preview_on_holdsAnAllowedMessageWithoutWaking', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  expect(world.toasts).toEqual([`${BOB} → you · dm · held for review`])
  expect(entriesOf(world)[0]?.disposition).toBe('held')
  expect(world.submits).toEqual([])
  await previewRead(world)
  expect(world.state.get(`preview:${MSG_ID}`)).toEqual({ status: 'ok', isVerified: true, hiddenChars: 0, truncatedChars: 0 })
})

test('test_preview_unverifiedMessage_drawsTheSignatureRowInRed', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${BOB}`)
  await rine($, world, 'preview on')
  world.readAnswer.value = JSON.stringify({ verification_status: 'unverifiable', from_agent_id: 'agent-b', decrypted_payload: { text: 'hello there' } })
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the held toast')
  await previewRead(world)
  world.state.set('focusId', MSG_ID)
  const pane = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'Pane', requestId: 'rine-inbox', props: PANE_PROPS as never })
  const signature = await pane.find({ key: 'detail:Signature' })
  expect(signature?.text).toBe('Signature  ✗ not verified')
  expect(signature?.children?.[1]).toMatchObject({ props: { color: 'error' } })
  await pane.unmount()
})

test('test_preview_decryptedText_neverReachesTheState', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await previewRead(world)
  world.state.set('focusId', MSG_ID)
  for (const component of ['AbovePrompt', 'Pane'] as const) {
    const props = component === 'Pane' ? PANE_PROPS : BAND_PROPS
    const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component, requestId: component === 'Pane' ? 'rine-inbox' : undefined, props: props as never })
    expect(JSON.stringify(await ui.drawn())).toContain('hello')
    await ui.unmount()
  }
  expect(JSON.stringify([...world.state])).not.toContain('hello there')
})

test('test_preview_decryptedText_isDrawnByTheBandAndThePane', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await previewRead(world)
  const band = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never })
  expect(await band.find({ type: 'Text', text: 'bob: "hello there"' })).toBeDefined()
  await band.unmount()
  world.state.set('focusId', MSG_ID)
  await world.clock.advance(1000)
  const pane = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'Pane', requestId: 'rine-inbox', props: PANE_PROPS as never })
  expect((await pane.find({ key: `row:${MSG_ID}` }))?.text).toContain('"hello there"')
  expect(await pane.find({ type: 'Text', text: 'hello there' })).toBeDefined()
  expect((await pane.find({ key: 'detail:Signature' }))?.text).toBe('Signature  ✓ verified')
  await pane.unmount()
})

test('test_preview_heldMessage_bandShowsReviewWithoutHand', async ($, on) => {
  const world = newWorld(on)
  await holdMessage($, world)
  await world.clock.advance(1000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'rine', surface, component: 'AbovePrompt', props: BAND_PROPS as never })
    expect((await ui.find({ key: 'head' }))?.text).toContain('◆ rine  1 new — bob (dm)')
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.props.label)).toEqual(['Review', 'Mark read', 'Mute 1h', 'Later'])
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
