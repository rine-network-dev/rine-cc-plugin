import { test, expect } from 'claude-code/testing'
import { createKit, splice, truncated } from './kit'

test('test_clock_advance_wakesSleepersInDeadlineOrder', async () => {
  const kit = createKit()
  const order: string[] = []
  const slow = kit.clock.sleep(300).then(() => {
    order.push('slow')
  })
  const fast = kit.clock.sleep(100).then(() => {
    order.push('fast')
  })
  await kit.clock.advance(400)
  await slow
  await fast
  expect(order).toEqual(['fast', 'slow'])
})

test('test_clock_settle_drivesSleepingWork', async () => {
  const kit = createKit()
  const work = (async () => {
    await kit.clock.sleep(100)
    return 'done'
  })()
  expect(await kit.clock.settle(work)).toBe('done')
})

test('test_clock_now_afterAdvance_movesForward', async () => {
  const kit = createKit({ now: 5000 })
  expect(await kit.clock.now()).toBe(5000)
  await kit.clock.advance(250)
  expect(await kit.clock.now()).toBe(5250)
})

test('test_fs_injectReads_servesTornTextThenRealContent', async () => {
  const kit = createKit()
  await kit.fs.write('/note', 'real')
  kit.fs.injectReads('/note', ['torn-1', 'torn-2'])
  expect(await kit.ports.fs.read('/note')).toBe('torn-1')
  expect(await kit.ports.fs.read('/note')).toBe('torn-2')
  expect(await kit.ports.fs.read('/note')).toBe('real')
})

test('test_splice_and_truncated_shapes', async () => {
  expect(splice('abcd', 'WXYZ')).toBe('abYZ')
  expect(truncated('abcdef')).toBe('abc')
})

test('test_kits_shareFsAndClock_whenPassedIn', async () => {
  const first = createKit()
  const second = createKit({ fs: first.fs, clock: first.clock })
  await first.ports.fs.write('/shared', 'hello')
  expect(await second.ports.fs.read('/shared')).toBe('hello')
  await first.clock.advance(10)
  expect(await second.clock.now()).toBe(await first.clock.now())
})

test('test_sink_append_countsRowsAndRecords', async () => {
  const kit = createKit()
  expect(await kit.ports.sink.append('one')).toBe(1)
  expect(await kit.ports.sink.append('two')).toBe(2)
  expect(kit.sink.textsOf('append')).toEqual(['one', 'two'])
})

test('test_sink_append_failing_resolvesNull', async () => {
  const kit = createKit()
  kit.sink.isAppendFailing = true
  expect(await kit.ports.sink.append('one')).toBeNull()
})

test('test_run_recordsArgvAndRejectsOnError', async () => {
  const kit = createKit()
  await expect(kit.ports.run(['rine', 'inbox'])).rejects.toThrow()
  expect(kit.runs).toEqual([['rine', 'inbox']])
  kit.setRun(() => ({ exitCode: 0, stdout: 'ok', stderr: '' }))
  expect(await kit.ports.run(['rine', 'send'])).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
  expect(kit.runs).toHaveLength(2)
})

test('test_random_sameSeed_sameSequence', async () => {
  const first = createKit({ seed: 7 })
  const second = createKit({ seed: 7 })
  const a = [first.ports.random(), first.ports.random(), first.ports.random()]
  const b = [second.ports.random(), second.ports.random(), second.ports.random()]
  expect(a).toEqual(b)
})

test('test_fs_write_failing_rejects', async () => {
  const kit = createKit()
  kit.fs.isWriteFailing = true
  await expect(kit.ports.fs.write('/note', 'x')).rejects.toThrow()
})
