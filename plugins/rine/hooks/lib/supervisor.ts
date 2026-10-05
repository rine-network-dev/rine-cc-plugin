import type { RineStream } from '../../types/index'
import { TIMING, backoffDelay, checkHealth, createRateGate, isCircuitOpen, nextAttempt } from './backoff'
import type { Frame } from './frames'
import type { Ports } from './ports'
import { safeLine } from './sanitize'
import { KILLED, kindOf, newRun, stepFrame, type Run, type SpawnChunk, type SpawnStream, type StreamEvent } from './supervisor-run'

/** `--heartbeat-timeout` sits between `staleAfterMs` and `deadAfterMs`, so the CLI's own reconnect never races the stale check. */
export const STREAM_ARGV = ['rine', '--json', 'stream', '--persistent', '--heartbeat-timeout', String(TIMING.cliSilenceS)] as const

export type SupervisorHost = {
  spawn: (argv: readonly string[], env: Record<string, string>) => SpawnStream
  after: (ms: number, fn: () => void) => () => void
  publish: (stream: RineStream) => void
  emit: (event: StreamEvent) => void
  log: (text: string) => void
}
export type Supervisor = {
  start: () => void
  stop: (next?: 'off' | 'peer', ownerCwd?: string | null) => void
  reconnect: () => void
}

const AUTH_FAILURE = /401|403|404|not registered|unauthori[sz]ed/i

export function createSupervisor(
  ports: Pick<Ports, 'clock' | 'random'>,
  host: SupervisorHost,
  configDir: string
): Supervisor {
  const stream: RineStream = { phase: 'off', attempt: 0, lastFrameAt: null, nextRetryAt: null, ownerCwd: null, unreadable: 0 }
  const gate = createRateGate(TIMING.logGateMs)
  let epoch = 0
  let isActive = false
  let hasSettled = false
  let run: Run | null = null
  let cancelTimer: (() => void) | null = null

  const publish = (patch: Partial<RineStream>): void => {
    Object.assign(stream, patch)
    host.publish({ ...stream })
  }
  const logGated = (key: string, now: number, text: string): void => {
    if (gate(key, now)) host.log(text)
  }
  const onError = (err: unknown): void => {
    host.log('rine: supervisor error ' + (err instanceof Error ? err.name : 'unknown'))
  }
  const clearTimer = (): void => {
    cancelTimer?.()
    cancelTimer = null
  }
  const schedule = (ms: number, fn: () => Promise<void>): void => {
    clearTimer()
    cancelTimer = host.after(ms, () => {
      void fn().catch(onError)
    })
  }
  const settle = (r: Run): void => {
    r.settleAt = null
    r.isCatchUp = false
    if (hasSettled) return
    hasSettled = true
    host.emit({ kind: 'settled' })
  }

  const applyFrame = (r: Run, frame: Frame, now: number): void => {
    if (frame.kind === 'invalid') {
      publish({ unreadable: stream.unreadable + 1 })
      logGated('invalid', now, `rine: unreadable stream line (${frame.reason})`)
      return
    }
    if (frame.kind === 'ignored') logGated('ignored', now, `rine: ignored stream event ${safeLine(frame.event, 40)}`)
    const effect = stepFrame(r, frame, stream.phase, now, hasSettled)
    publish(effect.patch)
    if (effect.event !== null) host.emit(effect.event)
    if (effect.isSettle) settle(r)
  }

  const onChunk = async (r: Run, chunk: SpawnChunk): Promise<void> => {
    const now = await ports.clock.now()
    if (chunk.stream === 'stderr') {
      if (AUTH_FAILURE.test(chunk.text)) r.isAuthFailure = true
      logGated('stderr', now, 'rine: stream stderr: ' + safeLine(chunk.text, 200))
      return
    }
    for (const frame of r.buffer.push(chunk.text)) {
      if (r.detector.note(kindOf(frame), now)) {
        logGated('hot', now, 'rine: stream hot loop, restarting')
        r.kill()
        return
      }
      applyFrame(r, frame, now)
    }
  }

  const pump = async (r: Run, token: number): Promise<void> => {
    for (;;) {
      const step = await Promise.race([r.child.next(), r.killed])
      if (step === KILLED || step.done || token !== epoch) return
      await onChunk(r, step.value)
      if (r.isOver) return
    }
  }

  /** A run that never got a server frame is dated from its first `connected`, so the status can still say how long. */
  const markStale = (r: Run): void => {
    if (stream.phase !== 'stale') publish({ phase: 'stale', lastFrameAt: stream.lastFrameAt ?? r.connectedAt })
  }

  const watch = async (r: Run, token: number): Promise<void> => {
    if (token !== epoch || r.isOver) return
    const now = await ports.clock.now()
    if (token !== epoch || r.isOver) return
    const health = { now, connectingSince: r.connectingSince, lastFrameAt: stream.lastFrameAt, connectedAt: r.connectedAt }
    if (r.settleAt !== null && r.isConnected && now >= r.settleAt) {
      if (checkHealth({ ...health, phase: 'live' }) !== 'ok') markStale(r)
      else if (stream.phase !== 'live') publish({ phase: 'live' })
      settle(r)
    }
    const phase = stream.phase
    if (phase === 'connecting' || phase === 'live' || phase === 'stale') {
      const verdict = checkHealth({ ...health, phase })
      if (verdict === 'kill') r.kill()
      else if (verdict === 'stale') markStale(r)
    }
    if (!r.isOver) schedule(TIMING.watchMs, () => watch(r, token))
  }

  const finish = async (r: Run, token: number): Promise<void> => {
    if (token !== epoch) return
    const now = await ports.clock.now()
    if (token !== epoch) return
    run = null
    if (r.isAuthFailure) {
      clearTimer()
      publish({ phase: 'auth-failed', nextRetryAt: null })
      return
    }
    const isHealthy = r.liveSince !== null && now - r.liveSince >= TIMING.minHealthyMs
    const attempt = nextAttempt(stream.attempt, isHealthy)
    const isOpen = isCircuitOpen(attempt)
    const wait = isOpen ? TIMING.probeMs : backoffDelay(attempt, ports.random)
    publish({ phase: isOpen ? 'offline' : 'backoff', attempt, nextRetryAt: now + wait })
    schedule(wait, launch)
  }

  const spawn = (): SpawnStream => {
    try {
      return host.spawn(STREAM_ARGV, { RINE_CONFIG_DIR: configDir })
    } catch (err) {
      return { next: () => Promise.reject(err), return: async () => undefined }
    }
  }

  async function launch(): Promise<void> {
    const token = epoch
    const now = await ports.clock.now()
    if (token !== epoch) return
    const r = newRun(spawn(), now)
    run = r
    publish({ phase: 'connecting', nextRetryAt: null, lastFrameAt: null })
    schedule(TIMING.watchMs, () => watch(r, token))
    try {
      await pump(r, token)
    } catch (err) {
      onError(err)
    }
    r.isOver = true
    await finish(r, token)
  }

  const halt = (): void => {
    epoch += 1
    clearTimer()
    run?.kill()
    run = null
  }

  return {
    start: () => {
      if (isActive) return
      isActive = true
      epoch += 1
      void launch().catch(onError)
    },
    stop: (next = 'off', ownerCwd = null) => {
      isActive = false
      halt()
      publish({ phase: next, nextRetryAt: null, ownerCwd })
    },
    reconnect: () => {
      halt()
      isActive = true
      publish({ attempt: 0, nextRetryAt: null, ownerCwd: null })
      void launch().catch(onError)
    }
  }
}
