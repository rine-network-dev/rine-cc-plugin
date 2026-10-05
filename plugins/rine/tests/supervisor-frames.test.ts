import { test, expect } from 'claude-code/testing'
import { TIMING } from '../hooks/lib/backoff'
import { at } from './at'
import { heartbeatLine, lifecycleLine, messageLine } from './frame-lines'
import { runRetry, startedRig, type StreamRig } from './stream-kit'

test('test_frames_invalidLine_countsUnreadableAndLogsOncePerWindow', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write('garbage\nmore garbage\n')
  await rig.step(0)
  expect(rig.stream().unreadable).toBe(2)
  expect(rig.logs.filter((line) => line.includes('unreadable'))).toHaveLength(1)
  expect(rig.stream().phase).toBe('connecting')
})

test('test_frames_messageSplitMidLine_deliveredOnce', async () => {
  const rig = await startedRig()
  const line = messageLine()
  at(rig.children, 0).write(lifecycleLine('connected'))
  at(rig.children, 0).write(line.slice(0, 30))
  await rig.step(0)
  expect(rig.events).toHaveLength(0)
  at(rig.children, 0).write(line.slice(30))
  await rig.step(0)
  expect(rig.events).toHaveLength(1)
})

test('test_catchUp_messagesBeforeSettle_backlogThenSettledOnce', async () => {
  const rig = await startedRig()
  const child = at(rig.children, 0)
  child.write(lifecycleLine('connected') + messageLine({ id: 'a' }) + messageLine({ id: 'b' }))
  await rig.step(0)
  expect(rig.events.map((e) => e.kind === 'message' && e.isBacklog)).toEqual([true, true])
  await rig.step(4000)
  expect(rig.events.filter((e) => e.kind === 'settled')).toHaveLength(1)
  expect(rig.stream().phase).toBe('live')
  child.write(messageLine({ id: 'c' }))
  await rig.step(0)
  const last = at(rig.events, rig.events.length - 1)
  expect(last.kind === 'message' && last.isBacklog).toBe(false)
})

test('test_catchUp_heartbeatSettlesWindow', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(lifecycleLine('connected') + messageLine({ id: 'a' }) + heartbeatLine() + messageLine({ id: 'b' }))
  await rig.step(0)
  expect(rig.events.map((e) => (e.kind === 'message' ? e.isBacklog : 'settled'))).toEqual([true, 'settled', false])
})

test('test_catchUp_afterRespawn_messagesRouteNormally', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(lifecycleLine('connected'))
  await rig.step(4000)
  at(rig.children, 0).exit()
  await rig.step(0)
  await runRetry(rig)
  at(rig.children, 1).write(lifecycleLine('connected') + messageLine({ id: 'late' }))
  await rig.step(0)
  const last = at(rig.events, rig.events.length - 1)
  expect(last.kind === 'message' && last.isBacklog).toBe(false)
  expect(rig.events.filter((e) => e.kind === 'settled')).toHaveLength(1)
})

test('test_catchUp_quietTimerRearmedByEachMessage', async () => {
  const rig = await startedRig()
  const child = at(rig.children, 0)
  child.write(lifecycleLine('connected') + messageLine({ id: 'a' }))
  await rig.step(2500)
  child.write(messageLine({ id: 'b' }))
  await rig.step(2500)
  expect(rig.events.filter((e) => e.kind === 'settled')).toHaveLength(0)
  await rig.step(1000)
  expect(rig.events.filter((e) => e.kind === 'settled')).toHaveLength(1)
})

const CHURN = lifecycleLine('reconnecting') + lifecycleLine('connecting') + lifecycleLine('connected')
/** One watch tick: the slack that lets a threshold land between two steps. */
const TICK = 1000

/** Steps the clock to `ms` after the last server frame. */
async function stepToQuiet(rig: StreamRig, ms: number): Promise<void> {
  await rig.step((rig.stream().lastFrameAt as number) + ms - (await rig.kit.clock.now()))
}

test('test_stale_lifecycleChurnWithoutServerFrame_staysStaleThenKillsAndBacksOff', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(0)
  await stepToQuiet(rig, TIMING.staleAfterMs + TICK)
  expect(rig.stream().phase).toBe('stale')
  at(rig.children, 0).write(CHURN)
  await rig.step(TICK)
  expect(rig.stream().phase).toBe('stale')
  await rig.step(TIMING.settleMs)
  expect(rig.stream().phase).toBe('stale')
  await stepToQuiet(rig, TIMING.deadAfterMs + TICK)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.stream().phase).toBe('backoff')
})

test('test_stale_unknownLifecycleState_doesNotRefreshTheSilenceClock', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(0)
  await stepToQuiet(rig, TIMING.staleAfterMs + TICK)
  const quietSince = rig.stream().lastFrameAt
  at(rig.children, 0).write(lifecycleLine('exploded'))
  await rig.step(TICK)
  expect(rig.stream().lastFrameAt).toBe(quietSince)
  expect(rig.stream().phase).toBe('stale')
})

test('test_settle_afterAnOverdueReconnect_staysStaleNotLive', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(heartbeatLine())
  await rig.step(0)
  await stepToQuiet(rig, TIMING.staleAfterMs - TICK)
  at(rig.children, 0).write(CHURN)
  const before = rig.published.length
  await rig.step(2 * TICK)
  expect(rig.stream().phase).toBe('connecting')
  await rig.step(TIMING.settleMs)
  expect(rig.stream().phase).toBe('stale')
  expect(rig.published.slice(before).map((one) => one.phase)).not.toContain('live')
})

test('test_exit_afterOnlyEverSettling_countsAsAFailedAttempt', async () => {
  const rig = await startedRig()
  at(rig.children, 0).write(lifecycleLine('connected'))
  await rig.step(TIMING.settleMs + TICK)
  expect(rig.stream().phase).toBe('live')
  await rig.step(TIMING.minHealthyMs + TICK)
  at(rig.children, 0).exit()
  await rig.step(0)
  expect(rig.stream().attempt).toBe(1)
})

test('test_stale_noServerFrameSinceFirstConnected_goesStaleAfterSeventyFiveSeconds', async () => {
  const rig = await startedRig()
  const connectedAt = await rig.kit.clock.now()
  at(rig.children, 0).write(lifecycleLine('connected'))
  await rig.step(TIMING.staleAfterMs - TICK)
  expect(rig.stream().phase).toBe('live')
  await rig.step(2 * TICK)
  expect(rig.stream().phase).toBe('stale')
  expect(rig.stream().lastFrameAt).toBeGreaterThanOrEqual(connectedAt)
  expect(rig.stream().lastFrameAt).toBeLessThanOrEqual(connectedAt + TICK)
})
