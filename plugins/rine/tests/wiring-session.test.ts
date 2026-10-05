import { expect, test } from 'claude-code/testing'
import { bodyOf, type LeaseBody } from './wiring-files'
import { begin, goLive, newWorld, start, streamPhase, until, type World } from './wiring-kit'

const leaseOf = (world: World): LeaseBody => bodyOf<LeaseBody>(world, 'lease')

test('test_session_headless_startsNoStreamAndRunsNoProcess', async ($, on) => {
  const world = newWorld(on, { isInteractive: false })
  await begin($, world)
  await world.clock.advance(6000)
  expect(world.spawns).toEqual([])
  expect(world.runs).toEqual([])
  expect(world.state.get('mode')).toBe('headless')
})

test('test_session_unregistered_probesTheVersionOnlyAndStartsNoStream', async ($, on) => {
  const world = newWorld(on)
  world.files.delete('/cfg/credentials.json')
  await begin($, world)
  await until(world, () => world.state.get('mode') === 'unregistered', 'the unregistered mode')
  expect(world.spawns).toEqual([])
  expect(world.runs).toEqual([['rine', '--version']])
})

test('test_session_mcpOnly_startsNoStream', async ($, on) => {
  const world = newWorld(on, { isRunFailing: true })
  await begin($, world)
  await until(world, () => world.state.get('mode') === 'mcp-only', 'the mcp-only mode')
  expect(world.spawns).toEqual([])
})

test('test_session_stateFolderReadOnly_streamsAndSaysSoInTheStatus', async ($, on) => {
  const world = newWorld(on)
  world.isWriteFailing = true
  await start($, world)
  await until(world, () => world.statuses[world.statuses.length - 1] === 'rine ◌ connecting… · state read-only', 'the read-only status')
  expect((world.state.get('identity') as { isStateWritable: boolean }).isStateWritable).toBe(false)
})

test('test_sessionEnd_clearAndResume_keepTheLeaseAndTheStream', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  for (const reason of ['clear', 'resume']) {
    await $.session.end({ reason } as never)
    await world.clock.advance(1000)
    expect(leaseOf(world).releasedAt).toBeNull()
    expect(world.state.get('isOwner')).toBe(true)
    expect(streamPhase(world)).toBe('live')
  }
})

test('test_sessionEnd_otherReason_releasesTheLeaseAndStopsTheStream', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  await $.session.end({ reason: 'other' } as never)
  await until(world, () => world.state.get('isOwner') === false, 'the lease release')
  expect(typeof leaseOf(world).releasedAt).toBe('number')
  expect(streamPhase(world)).toBe('off')
})

test('test_permissionMode_recordedFromMainPromptsOnly', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  expect(world.state.get('permissionMode')).toBeNull()
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'acceptEdits' } as never)
  await until(world, () => world.state.get('permissionMode') === 'acceptEdits', 'the permission mode')
  await $.classic.UserPromptSubmit({ prompt: 'x', permission_mode: 'bypassPermissions', agent_id: 'sub' } as never)
  await world.clock.advance(1000)
  expect(world.state.get('permissionMode')).toBe('acceptEdits')
})
