import { expect, test } from 'claude-code/testing'
import { BOB, goLive, newWorld, rine, start, until, type World } from './wiring-kit'
import { pathOf } from './wiring-files'

const mutedUntil = (world: World): unknown =>
  (world.state.get('prefs') as { mutedUntil: unknown } | undefined)?.mutedUntil ?? null

test('test_command_rineAlone_opensTheInboxPane', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = (await rine($, world, '')) as { text: string }
  expect(answer.text).toBe('rine inbox opened.')
  expect(world.opens).toHaveLength(1)
  expect((world.opens[0] as { id: string }).id).toBe('rine-inbox')
})

test('test_command_allowAddListRemove_roundTripThroughTheListsFile', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, `allow add ${BOB}`)) as { text: string }).text).toBe(`${BOB} is on the allow list.`)
  expect(world.files.get(pathOf('lists'))).toContain(BOB)
  expect(((await rine($, world, 'allow list')) as { text: string }).text).toBe(`allow list (1): ${BOB}`)
  expect(((await rine($, world, `allow remove ${BOB}`)) as { text: string }).text).toBe(`${BOB} left the allow list`)
  expect(((await rine($, world, 'allow list')) as { text: string }).text).toBe('allow list (0): empty')
})

test('test_command_denyAdd_listsTheHandleAndDenyListStartsEmpty', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, 'deny list')) as { text: string }).text).toBe('deny list (0): empty')
  expect(((await rine($, world, `deny add ${BOB}`)) as { text: string }).text).toBe(`${BOB} is on the deny list.`)
  expect(((await rine($, world, 'deny list')) as { text: string }).text).toBe(`deny list (1): ${BOB}`)
})

test('test_command_removeOfAnAbsentHandle_saysSo', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, `allow remove ${BOB}`)) as { text: string }).text).toBe(`${BOB} was not on the allow list`)
})

test('test_command_handleThatIsNotOne_isRejected', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, 'allow add nonsense')) as { text: string }).text).toBe('nonsense is not a handle: use name@org or #group@org.')
})

test('test_command_mute_writesTheDeadlineAndUnmuteClearsIt', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, 'mute 8h')) as { text: string }).text).toBe('muted for 8h')
  await until(world, () => mutedUntil(world) !== null, 'the mute')
  expect(typeof mutedUntil(world)).toBe('number')
  expect(world.files.has(pathOf('prefs'))).toBe(true)
  expect(((await rine($, world, 'unmute')) as { text: string }).text).toBe('unmuted')
  await until(world, () => mutedUntil(world) === null, 'the unmute')
  expect(mutedUntil(world)).toBeNull()
})

test('test_command_muteForever_roundTrips', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  expect(((await rine($, world, 'mute forever')) as { text: string }).text).toBe('muted until you unmute')
  await until(world, () => mutedUntil(world) !== null, 'the mute')
  expect(mutedUntil(world)).toBe('forever')
})

test('test_command_unknownSubcommand_answersTheUsageLine', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = (await rine($, world, 'bogus')) as { text: string }
  expect(answer.text.startsWith('usage: /rine [mute')).toBe(true)
})
