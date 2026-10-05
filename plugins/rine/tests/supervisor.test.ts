import { test, expect } from 'claude-code/testing'
import { STREAM_ARGV } from '../hooks/lib/supervisor'
import { at } from './at'
import { heartbeatLine, lifecycleLine } from './frame-lines'
import { createStreamRig, failChildren, runRetry, startedRig } from './stream-kit'

test('test_start_spawnsStreamWithoutMonitorAndConfigDirEnv', async () => {
  const rig = await startedRig()
  expect(rig.spawns).toEqual([{ argv: STREAM_ARGV, env: { RINE_CONFIG_DIR: '/cfg' } }])
  expect(STREAM_ARGV).not.toContain('--monitor')
  expect(rig.stream().phase).toBe('connecting')
})

test('test_start_calledTwice_spawnsOnce', async () => {
  const rig = await startedRig()
  rig.supervisor.start()
  await rig.step(0)
  expect(rig.children).toHaveLength(1)
})

test('test_connected_withChurn_staysConnecting', async () => {
  const rig = await startedRig()
  const child = at(rig.children, 0)
  child.write(lifecycleLine('connected'))
  await rig.step(2500)
  child.write(lifecycleLine('reconnecting') + lifecycleLine('connecting') + lifecycleLine('connected'))
  await rig.step(2500)
  expect(rig.stream().phase).toBe('connecting')
})

test('test_connected_standingThreeSeconds_goesLive', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(lifecycleLine('connecting') + lifecycleLine('connected'))
  await rig.step(2000)
  expect(rig.stream().phase).toBe('connecting')
  await rig.step(1500)
  expect(rig.stream().phase).toBe('live')
})

test('test_heartbeat_afterConnecting_goesLive', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(0)
  expect(rig.stream().phase).toBe('live')
})

test('test_connecting_ninetySecondsWithoutProof_killsAndBacksOff', async () => {
  const rig = await startedRig()
  await rig.step(91000)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.stream().phase).toBe('backoff')
  expect(rig.stream().attempt).toBe(1)
})

test('test_live_seventyFiveSecondsQuiet_goesStale', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(74000)
  expect(rig.stream().phase).toBe('live')
  await rig.step(2000)
  expect(rig.stream().phase).toBe('stale')
})

test('test_stale_frameArrives_goesLiveAgain', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(80000)
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(0)
  expect(rig.stream().phase).toBe('live')
})

test('test_stale_oneFiftySecondsQuiet_killsAndBacksOff', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(151000)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.stream().phase).toBe('backoff')
})

test('test_hotLoop_sixtyCyclesInOneChunk_killedBeforeTwoHundredLines', async () => {
  const rig = await startedRig()
  const cycle = lifecycleLine('reconnecting') + lifecycleLine('connecting') + lifecycleLine('connected')
  at(rig.children, 0).write(cycle.repeat(60))
  await rig.step(0)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.stream().phase).toBe('backoff')
  expect(rig.logs.some((line) => line.includes('hot loop'))).toBe(true)
})

test('test_hotLoop_manyLinesWithoutMessage_killed', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write((JSON.stringify({ event: 'status', data: {} }) + '\n').repeat(250))
  await rig.step(0)
  expect(at(rig.children, 0).isReturned).toBe(true)
})

test('test_exit_sixConsecutiveFailures_opensCircuitOffline', async () => {
  const rig = await startedRig()
  await failChildren(rig, 5)
  expect(rig.stream().phase).toBe('connecting')
  at(rig.children, 5).exit()
  await rig.step(0)
  expect(rig.stream().phase).toBe('offline')
  expect(rig.stream().attempt).toBe(6)
  expect(rig.stream().nextRetryAt).toBe((await rig.kit.clock.now()) + 300000)
})

test('test_offline_probeTimer_spawnsAnotherAttempt', async () => {
  const rig = await startedRig()
  await failChildren(rig, 5)
  at(rig.children, 5).exit()
  await rig.step(0)
  await runRetry(rig)
  expect(rig.children).toHaveLength(7)
})

test('test_reconnect_fromOffline_resetsCircuitAndSpawnsNow', async () => {
  const rig = await startedRig()
  await failChildren(rig, 5)
  at(rig.children, 5).exit()
  await rig.step(0)
  rig.supervisor.reconnect()
  await rig.step(0)
  expect(rig.stream().phase).toBe('connecting')
  expect(rig.stream().attempt).toBe(0)
  expect(rig.children).toHaveLength(7)
})

test('test_stderr_authLine_afterExit_authFailedNoRetry', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write('Error: 401 Unauthorized\n', 'stderr')
  at(rig.children, 0).exit()
  await rig.step(0)
  expect(rig.stream().phase).toBe('auth-failed')
  await rig.step(400000)
  expect(rig.children).toHaveLength(1)
})

test('test_stderr_ordinaryLine_loggedSanitisedNotAuthFailure', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write('\x1b[31mwarning: slow\x1b[0m\n', 'stderr')
  at(rig.children, 0).exit()
  await rig.step(0)
  expect(rig.logs).toContain('rine: stream stderr: warning: slow')
  expect(rig.stream().phase).toBe('backoff')
})

test('test_exit_afterThirtySecondsLive_resetsAttemptToZero', async () => {
  const rig = await startedRig()
  at(rig.children, 0).exit()
  await rig.step(0)
  await runRetry(rig)
  expect(rig.stream().attempt).toBe(1)
  at(rig.children, 1).write(heartbeatLine())
  await rig.step(31000)
  at(rig.children, 1).exit()
  await rig.step(0)
  const now = await rig.kit.clock.now()
  expect(rig.stream().attempt).toBe(0)
  expect(rig.stream().nextRetryAt).toBeGreaterThanOrEqual(now + 5000)
  expect(rig.stream().nextRetryAt).toBeLessThan(now + 5500)
})

test('test_spawn_throws_countsAsFailedAttempt', async () => {
  const rig = createStreamRig()
  rig.isSpawnFailing = true
  rig.supervisor.start()
  await rig.step(0)
  expect(rig.stream().phase).toBe('backoff')
  expect(rig.stream().attempt).toBe(1)
})

test('test_stop_killsChildAndCancelsRetry', async () => {
  const rig = await startedRig()
  rig.supervisor.stop('peer', '/work/other')
  await rig.step(0)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.stream().phase).toBe('peer')
  expect(rig.stream().ownerCwd).toBe('/work/other')
  expect(rig.stream().nextRetryAt).toBeNull()
  await rig.step(400000)
  expect(rig.children).toHaveLength(1)
})

test('test_stop_duringBackoff_neverRespawns', async () => {
  const rig = await startedRig()
  at(rig.children, 0).exit()
  await rig.step(0)
  rig.supervisor.stop()
  await rig.step(400000)
  expect(rig.children).toHaveLength(1)
  expect(rig.stream().phase).toBe('off')
})
