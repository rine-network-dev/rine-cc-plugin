import { TIMING, backoffDelay, createRateGate, isCircuitOpen, nextAttempt } from './backoff'
import type { RineOrgPhase, RineOrgStopReason } from '../../types/index'
import type { OrgFrame, OrgIdentity } from './org-frames'
import { EXIT_NO_IDENTITY, EXIT_REFUSED, FEED_ARGV, HELLO_TIMEOUT_MS, ONCE_ARGV, stopReasonOf } from './org-feed-config'
import { drain, openRun, type Run } from './org-feed-run'
import type { Ports } from './ports'
import { safeLine } from './sanitize'
import type { SpawnStream } from './supervisor-run'

export type OrgStopReason = RineOrgStopReason

export type OrgPhase = Exclude<RineOrgPhase, 'ack'>

/** `sentence` is the feed's own words for a stop it explained; the caller scrubs it when drawing. */
export type OrgFeedStatus = { phase: OrgPhase; reason: OrgStopReason | null; sentence: string | null }

/** A row, finding, page or error frame. `hello` leaves the feed only as `onOrg`; heartbeats and unreadable lines never do. */
export type OrgFeedFrame = Extract<OrgFrame, { kind: 'row' | 'finding' | 'page' | 'error' }>

export type OrgFeedHost = {
  spawn: (argv: readonly string[], env: Record<string, string>) => SpawnStream
  after: (ms: number, fn: () => void) => () => void
  log: (text: string) => void
}

export type OrgFeedSink = {
  onFrame: (frame: OrgFeedFrame) => void
  /** The org the first `hello` of a feed child names, or null when the CLI does not say. */
  onOrg: (org: OrgIdentity | null) => void
  onStatus: (status: OrgFeedStatus) => void
}

export type OrgFeed = {
  start: () => void
  /** Ends the feed and any older-page child. */
  stop: () => void
  /** Reads one older page; resolves when that child ended. Does nothing while one is running. */
  loadOlder: (cursor: string) => Promise<void>
}

/** What one feed child showed before it ended. */
type Seen = { hello: boolean; lastError: Extract<OrgFrame, { kind: 'error' }> | null; liveSince: number | null }

export function createOrgFeed(
  ports: Pick<Ports, 'clock' | 'random'>,
  host: OrgFeedHost,
  sink: OrgFeedSink,
  env: Record<string, string>
): OrgFeed {
  const gate = createRateGate(TIMING.logGateMs)
  let epoch = 0
  let isActive = false
  let attempt = 0
  let run: Run | null = null
  let older: Run | null = null
  let cancelTimer: (() => void) | null = null
  let isHelloRetried = false

  /** A sink that throws must not reject the drain loop, which has no handler. */
  const guarded = (call: () => void): void => {
    try {
      call()
    } catch {
      host.log('rine: org feed sink threw')
    }
  }
  const status = (phase: OrgPhase, reason: OrgStopReason | null = null, sentence: string | null = null): void => {
    guarded(() => sink.onStatus({ phase, reason, sentence }))
  }
  const clearTimer = (): void => {
    cancelTimer?.()
    cancelTimer = null
  }
  const spawn = (argv: readonly string[]): Run => {
    try {
      return openRun(host.spawn(argv, env))
    } catch (err) {
      return openRun({ next: () => Promise.reject(err), return: async () => undefined })
    }
  }
  const logGated = async (key: string, text: string): Promise<void> => {
    if (gate(key, await ports.clock.now())) host.log(text)
  }

  const onStderr = (): Promise<void> => logGated('stderr', 'rine: org feed wrote to stderr')
  const forward = async (frame: OrgFrame): Promise<void> => {
    if (frame.kind === 'invalid') await logGated('invalid', `rine: unreadable org feed line (${frame.reason})`)
    else if (frame.kind === 'ignored') await logGated('ignored', `rine: ignored org feed event ${safeLine(frame.event, 40)}`)
    else if (frame.kind !== 'hello' && frame.kind !== 'heartbeat') guarded(() => sink.onFrame(frame))
  }

  const halt = (): void => {
    epoch += 1
    clearTimer()
    run?.kill()
    run = null
    older?.kill()
    older = null
  }
  const stopWith = (reason: OrgStopReason, sentence: string | null): void => {
    isActive = false
    halt()
    status('stopped', reason, sentence)
  }

  async function launch(): Promise<void> {
    const token = epoch
    const r = spawn(FEED_ARGV)
    run = r
    const seen: Seen = { hello: false, lastError: null, liveSince: null }
    status('starting')
    const cancelHello = host.after(HELLO_TIMEOUT_MS, () => {
      if (token !== epoch || seen.hello) return
      if (isHelloRetried) return stopWith('cli_too_old', null)
      // A cold or loaded start can outlast the timeout: one fresh child before calling the CLI too old.
      isHelloRetried = true
      halt()
      void launch()
    })
    const code = await drain(r, onStderr, async (frame) => {
      if (frame.kind === 'hello' && !seen.hello) {
        seen.hello = true
        const now = await ports.clock.now()
        if (token !== epoch || r.isOver) return
        seen.liveSince = now
        cancelHello()
        guarded(() => sink.onOrg(frame.org))
        status('live')
      }
      if (frame.kind === 'error') seen.lastError = frame
      await forward(frame)
    })
    cancelHello()
    if (token !== epoch || r.isOver) return
    run = null
    await finish(token, code, seen)
  }

  async function finish(token: number, code: number | null, seen: Seen): Promise<void> {
    const { hello, lastError } = seen
    // Only a child that ran and exited without a word is a CLI that predates the feed; no exit code means it never
    // ran (missing binary, spawn error) or was killed, which is transient and takes the backoff path below.
    if (!hello && lastError === null && code !== null) return stopWith('cli_too_old', null)
    const fallback = code === EXIT_NO_IDENTITY ? 'no_identity' : 'auth_refused'
    if (code === EXIT_NO_IDENTITY || code === EXIT_REFUSED) {
      return stopWith(stopReasonOf(lastError?.code) ?? fallback, lastError?.sentence ?? null)
    }
    const now = await ports.clock.now()
    if (token !== epoch) return
    const isHealthy = seen.liveSince !== null && now - seen.liveSince >= TIMING.minHealthyMs
    attempt = nextAttempt(attempt, isHealthy)
    const wait = isCircuitOpen(attempt) ? TIMING.probeMs : backoffDelay(attempt, ports.random)
    status('paused', stopReasonOf(lastError?.code), lastError?.sentence ?? null)
    cancelTimer = host.after(wait, () => {
      cancelTimer = null
      if (token === epoch) void launch()
    })
  }

  return {
    start: () => {
      if (isActive) return
      isActive = true
      attempt = 0
      isHelloRetried = false
      epoch += 1
      void launch()
    },
    stop: () => {
      isActive = false
      halt()
      status('idle')
    },
    loadOlder: async (cursor) => {
      if (older !== null || !isActive) return
      const token = epoch
      const r = spawn([...ONCE_ARGV, cursor])
      older = r
      await drain(r, onStderr, forward)
      if (token === epoch && older === r) older = null
    }
  }
}
