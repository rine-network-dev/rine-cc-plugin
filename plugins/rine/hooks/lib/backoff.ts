export const TIMING = {
  baseMs: 5000,
  maxMs: 300000,
  jitterRatio: 0.1,
  minHealthyMs: 30000,
  settleMs: 3000,
  connectingTimeoutMs: 90000,
  staleAfterMs: 75000,
  cliSilenceS: 80,
  deadAfterMs: 150000,
  probeMs: 300000,
  circuitOpenAt: 6,
  hotConnecting: 5,
  hotLines: 200,
  hotWindowMs: 10000,
  watchMs: 500,
  logGateMs: 10000
} as const

/** Attempts 0 and 1 give the base (the bash monitor this ports once returned the cap for 0). */
export function backoffDelay(attempt: number, random: () => number): number {
  const base =
    attempt <= 1 ? TIMING.baseMs : Math.min(TIMING.maxMs, TIMING.baseMs * 2 ** Math.min(attempt - 1, 30))
  return base + Math.floor(random() * TIMING.jitterRatio * base)
}

export function nextAttempt(attempt: number, isHealthy: boolean): number {
  return isHealthy ? 0 : attempt + 1
}

export function isCircuitOpen(attempt: number): boolean {
  return attempt >= TIMING.circuitOpenAt
}

export type LineKind = 'message' | 'connecting' | 'other'
export type HotLoopDetector = { note: (kind: LineKind, now: number) => boolean }

/** True when a line trips the breaker: the CLI's reconnect hot loop prints lines at ~3 ms/cycle. */
export function createHotLoopDetector(): HotLoopDetector {
  let lines: number[] = []
  let connecting: number[] = []
  return {
    note: (kind, now) => {
      const cutoff = now - TIMING.hotWindowMs
      lines = lines.filter((at) => at > cutoff)
      connecting = connecting.filter((at) => at > cutoff)
      if (kind === 'message') {
        lines = []
        return false
      }
      lines.push(now)
      if (kind === 'connecting') connecting.push(now)
      return connecting.length > TIMING.hotConnecting || lines.length > TIMING.hotLines
    }
  }
}

export type HealthInput = {
  phase: 'connecting' | 'live' | 'stale'
  now: number
  connectingSince: number
  lastFrameAt: number | null
  connectedAt: number | null
}
export type HealthVerdict = 'ok' | 'stale' | 'kill'

export function checkHealth(input: HealthInput): HealthVerdict {
  const { phase, now, connectingSince, lastFrameAt, connectedAt } = input
  if (phase === 'connecting') return now - connectingSince >= TIMING.connectingTimeoutMs ? 'kill' : 'ok'
  const since = lastFrameAt ?? connectedAt
  if (since === null) return 'ok'
  const quiet = now - since
  if (phase === 'live') return quiet >= TIMING.staleAfterMs ? 'stale' : 'ok'
  return quiet >= TIMING.deadAfterMs ? 'kill' : 'ok'
}

export function createRateGate(windowMs: number): (key: string, now: number) => boolean {
  const last = new Map<string, number>()
  return (key, now) => {
    const before = last.get(key)
    if (before !== undefined && now - before < windowMs) return false
    last.set(key, now)
    return true
  }
}
