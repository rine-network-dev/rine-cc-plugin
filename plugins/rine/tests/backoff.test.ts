import { test, expect } from 'claude-code/testing'
import {
  TIMING,
  backoffDelay,
  checkHealth,
  createHotLoopDetector,
  createRateGate,
  isCircuitOpen,
  nextAttempt
} from '../hooks/lib/backoff'

const zero = (): number => 0

test('test_backoffDelay_attemptZeroAndOne_giveBaseNotCap', () => {
  expect(backoffDelay(0, zero)).toBe(5000)
  expect(backoffDelay(1, zero)).toBe(5000)
})

test('test_backoffDelay_attempts2to6_doubleEachTime', () => {
  expect([2, 3, 4, 5, 6].map((attempt) => backoffDelay(attempt, zero))).toEqual([10000, 20000, 40000, 80000, 160000])
})

test('test_backoffDelay_largeAttempts_capAtMax', () => {
  for (const attempt of [7, 50, 10000]) expect(backoffDelay(attempt, zero)).toBe(300000)
})

test('test_backoffDelay_jitterOneSided_underTenPercent', () => {
  const delay = backoffDelay(1, () => 0.999)
  expect(delay).toBe(5000 + Math.floor(0.999 * 500))
  expect(delay).toBeLessThan(5500)
})

test('test_backoffDelay_randomZero_neverShortensBase', () => {
  expect(backoffDelay(3, zero)).toBe(20000)
})

test('test_nextAttempt_healthy_resetsToZero', () => {
  expect(nextAttempt(4, true)).toBe(0)
})

test('test_nextAttempt_unhealthy_increments', () => {
  expect(nextAttempt(4, false)).toBe(5)
})

test('test_isCircuitOpen_atSixFailures_opens', () => {
  expect(isCircuitOpen(5)).toBe(false)
  expect(isCircuitOpen(6)).toBe(true)
  expect(isCircuitOpen(7)).toBe(true)
})

test('test_hotLoop_fiveConnecting_doNotTripSixthDoes', () => {
  const detector = createHotLoopDetector()
  for (let i = 0; i < 5; i++) expect(detector.note('connecting', 1000)).toBe(false)
  expect(detector.note('connecting', 1000)).toBe(true)
})

test('test_hotLoop_connectingOutsideWindow_notCounted', () => {
  const detector = createHotLoopDetector()
  for (const at of [0, 2000, 4000, 6000, 8000]) detector.note('connecting', at)
  expect(detector.note('connecting', 12000)).toBe(false)
})

test('test_hotLoop_twoHundredLines_doNotTripTheNextDoes', () => {
  const detector = createHotLoopDetector()
  for (let i = 0; i < 200; i++) expect(detector.note('other', 500)).toBe(false)
  expect(detector.note('other', 500)).toBe(true)
})

test('test_hotLoop_messageInBetween_resetsLineCount', () => {
  const detector = createHotLoopDetector()
  for (let i = 0; i < 200; i++) detector.note('other', 500)
  expect(detector.note('message', 500)).toBe(false)
  for (let i = 0; i < 200; i++) expect(detector.note('other', 500)).toBe(false)
})

test('test_hotLoop_linesOlderThanWindow_pruned', () => {
  const detector = createHotLoopDetector()
  for (let i = 0; i < 200; i++) detector.note('other', 0)
  expect(detector.note('other', 10001)).toBe(false)
})

test('test_checkHealth_connecting_killsAtNinetySeconds', () => {
  const base = { phase: 'connecting', connectingSince: 0, lastFrameAt: null, connectedAt: null } as const
  expect(checkHealth({ ...base, now: 89999 })).toBe('ok')
  expect(checkHealth({ ...base, now: 90000 })).toBe('kill')
})

test('test_checkHealth_live_staleAtSeventyFiveSeconds', () => {
  const base = { phase: 'live', connectingSince: 0, lastFrameAt: 1000, connectedAt: null } as const
  expect(checkHealth({ ...base, now: 75999 })).toBe('ok')
  expect(checkHealth({ ...base, now: 76000 })).toBe('stale')
})

test('test_checkHealth_liveWithoutFrame_ok', () => {
  expect(checkHealth({ phase: 'live', connectingSince: 0, lastFrameAt: null, connectedAt: null, now: 999999 })).toBe('ok')
})

test('test_checkHealth_stale_killsAtOneFiftySeconds', () => {
  const base = { phase: 'stale', connectingSince: 0, lastFrameAt: 1000, connectedAt: null } as const
  expect(checkHealth({ ...base, now: 150999 })).toBe('ok')
  expect(checkHealth({ ...base, now: 151000 })).toBe('kill')
})

test('test_rateGate_insideWindow_blocksThenAllowsAfter', () => {
  const gate = createRateGate(10000)
  expect(gate('a', 0)).toBe(true)
  expect(gate('a', 9999)).toBe(false)
  expect(gate('a', 10000)).toBe(true)
})

test('test_rateGate_differentKeys_independent', () => {
  const gate = createRateGate(10000)
  expect(gate('a', 0)).toBe(true)
  expect(gate('b', 1)).toBe(true)
})

test('test_timing_cliSilence_sitsBetweenStaleAndDead', () => {
  const cliSilenceMs = TIMING.cliSilenceS * 1000
  expect(TIMING.staleAfterMs).toBeLessThan(cliSilenceMs)
  expect(cliSilenceMs).toBeLessThan(TIMING.deadAfterMs)
})
