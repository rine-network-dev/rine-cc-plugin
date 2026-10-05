import { test, expect } from 'claude-code/testing'
import { limitRuns, RUNS_PER_MINUTE, type ClockPort, type RunInit, type RunPort } from '../hooks/lib/ports'
import { createKit } from './kit'

function recordingRun(clock: ClockPort, starts: number[]): RunPort {
  return async () => {
    starts.push(await clock.now())
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

test('test_limitRuns_underCap_runsImmediately', async () => {
  const kit = createKit()
  const starts: number[] = []
  const run = limitRuns(recordingRun(kit.clock, starts), kit.clock, 6)
  const before = await kit.clock.now()
  await kit.clock.settle(
    Promise.all([run(['a']), run(['b']), run(['c']), run(['d']), run(['e']), run(['f'])]),
    0
  )
  expect(starts).toHaveLength(6)
  expect(await kit.clock.now()).toBe(before)
})

test('test_limitRuns_overCap_waitsUntilWindowFrees', async () => {
  const kit = createKit()
  const starts: number[] = []
  const run = limitRuns(recordingRun(kit.clock, starts), kit.clock, 6)
  const t = await kit.clock.now()
  await Promise.all([run(['a']), run(['b']), run(['c']), run(['d']), run(['e']), run(['f'])])
  await kit.clock.settle(run(['g']))
  expect(starts[6]).toBeGreaterThanOrEqual(t + 60000)
  expect(starts[6]).toBeLessThan(t + 60100)
})

test('test_limitRuns_windowSlides', async () => {
  const kit = createKit()
  const starts: number[] = []
  const run = limitRuns(recordingRun(kit.clock, starts), kit.clock, 2)
  const first = await kit.clock.now()
  await run(['a'])
  await kit.clock.advance(15000)
  await run(['b'])
  await kit.clock.advance(15000)
  await kit.clock.settle(run(['c']))
  expect(starts[2]).toBe(first + 60000)
})

test('test_limitRuns_propagatesRejection', async () => {
  const kit = createKit()
  const error = new Error('boom')
  const starts: number[] = []
  let calls = 0
  const run = limitRuns(async () => {
    starts.push(await kit.clock.now())
    calls += 1
    if (calls === 1) throw error
    return { exitCode: 0, stdout: '', stderr: '' }
  }, kit.clock, 1)
  let caught: unknown
  try {
    await run(['a'])
  } catch (err) {
    caught = err
  }
  expect(caught).toBe(error)
  const t = await kit.clock.now()
  await kit.clock.settle(run(['b']))
  expect(starts[1]).toBeGreaterThanOrEqual(t + 60000)
})

test('test_limitRuns_passesArgvAndInit', async () => {
  const kit = createKit()
  let seenArgv: readonly string[] = []
  let seenInit: RunInit | undefined
  const run = limitRuns(async (argv, init) => {
    seenArgv = argv
    seenInit = init
    return { exitCode: 0, stdout: '', stderr: '' }
  }, kit.clock, 6)
  const init: RunInit = { timeoutMs: 5000, env: { RINE: '1' } }
  await run(['rine', 'send'], init)
  expect(seenArgv).toEqual(['rine', 'send'])
  expect(seenInit).toEqual(init)
})

test('test_RUNS_PER_MINUTE_isSix', async () => {
  expect(RUNS_PER_MINUTE).toBe(6)
})
