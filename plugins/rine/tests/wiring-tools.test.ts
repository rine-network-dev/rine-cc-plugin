import { expect, test } from 'claude-code/testing'
import { messageLine } from './frame-lines'
import { pathOf } from './wiring-files'
import { MSG_ID, entriesOf, goLive, newWorld, start, until } from './wiring-kit'

const DENIED = 'rine: those files are managed from /rine; ask the user to change them there.'

test('test_guard_writeIntoTheStateFolder_isDenied', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const calls = [
    { tool: 'Write', file_path: pathOf('lists') },
    { tool: 'Edit', file_path: pathOf('lease') },
    { tool: 'Write', file_path: '/cfg/state/cc/brand-new.json' },
    { tool: 'MultiEdit', file_path: pathOf('ledger') }
  ]
  for (const call of calls) {
    const answer = await $.tool.call({ ...call, content: 'x' } as never)
    expect(answer).toEqual({ deny: DENIED })
  }
})

test('test_guard_shellCommandNamingTheStateFolder_isDenied', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = await $.tool.call({ tool: 'Bash', command: 'echo x > /cfg/state/cc/lists.json' } as never)
  expect(answer).toEqual({ deny: DENIED })
})

test('test_guard_checkThrows_deniesTheCall', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.isCwdFailing = true
  const answer = await $.tool.call({ tool: 'Write', file_path: '/proj/a.txt', content: 'x' } as never)
  expect(answer).toEqual({ deny: 'rine: the file guard failed, so the call is not allowed.' })
})

test('test_guard_writeOutsideTheStateFolder_passesThrough', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  const answer = await $.tool.call({ tool: 'Write', file_path: '/proj/a.txt', content: 'x' } as never)
  expect(answer).toEqual({ result: 'done' })
})

test('test_readMark_rineReadCall_marksTheEntryRead', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  const answer = await $.tool.call({ tool: 'mcp__plugin_rine_rine__rine_read', message_id: MSG_ID } as never)
  expect(answer).toEqual({ result: 'done' })
  await until(world, () => entriesOf(world)[0]?.state === 'read', 'the entry marked read')
  expect(entriesOf(world)[0]?.state).toBe('read')
})

test('test_readMark_otherRineTool_leavesTheEntryUnread', async ($, on) => {
  const world = newWorld(on)
  await start($, world)
  await goLive(world)
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the arrival toast')
  await $.tool.call({ tool: 'mcp__plugin_rine_rine__rine_inbox' } as never)
  await world.clock.advance(2000)
  expect(entriesOf(world)[0]?.state).toBe('unread')
})
