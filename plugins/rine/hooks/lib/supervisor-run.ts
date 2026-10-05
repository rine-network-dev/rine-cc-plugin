import type { RinePhase, RineStream } from '../../types/index'
import { TIMING, createHotLoopDetector, type HotLoopDetector, type LineKind } from './backoff'
import { createLineBuffer, isServerFrame, type Frame, type LineBuffer, type StreamMessage } from './frames'

export type SpawnChunk = { stream: 'stdout' | 'stderr'; text: string }
export type SpawnStream = {
  next: () => Promise<IteratorResult<SpawnChunk, unknown>>
  /** Ends the child; may settle only after a pending next() settles. */
  return: () => Promise<unknown>
}
export type StreamEvent = { kind: 'message'; message: StreamMessage; isBacklog: boolean } | { kind: 'settled' }

export const KILLED = 'killed' as const

/** One child's life. Mutable bookkeeping owned by the supervisor; the frame logic lives in `stepFrame`. */
export type Run = {
  child: SpawnStream
  buffer: LineBuffer
  detector: HotLoopDetector
  liveSince: number | null
  connectingSince: number
  /** The first `connected` line of this child: the CLI prints it before any server byte, so it only dates a run that never got a server frame. */
  connectedAt: number | null
  settleAt: number | null
  isConnected: boolean
  isCatchUp: boolean
  isAuthFailure: boolean
  isOver: boolean
  kill: () => void
  killed: Promise<typeof KILLED>
}

export function newRun(child: SpawnStream, now: number): Run {
  let resolveKilled: (value: typeof KILLED) => void = () => {}
  const killed = new Promise<typeof KILLED>((resolve) => {
    resolveKilled = resolve
  })
  const run: Run = {
    child,
    buffer: createLineBuffer(),
    detector: createHotLoopDetector(),
    liveSince: null,
    connectingSince: now,
    connectedAt: null,
    settleAt: null,
    isConnected: false,
    isCatchUp: false,
    isAuthFailure: false,
    isOver: false,
    killed,
    kill: () => {
      run.isOver = true
      resolveKilled(KILLED)
      void child.return().catch(() => {})
    }
  }
  return run
}

export function kindOf(frame: Frame): LineKind {
  if (frame.kind === 'message') return 'message'
  return frame.kind === 'lifecycle' && frame.state === 'connecting' ? 'connecting' : 'other'
}

export type FrameEffect = { patch: Partial<RineStream>; event: StreamEvent | null; isSettle: boolean }

/**
 * Applies a valid frame to the run: a heartbeat or message proves live, `connected` only arms the quiet timer.
 * Only server frames refresh `lastFrameAt`, see `isServerFrame`.
 * The caller publishes `patch`, emits `event`, and settles the stream when `isSettle` is set.
 */
export function stepFrame(run: Run, frame: Frame, phase: RinePhase, now: number, isSettled: boolean): FrameEffect {
  const patch: Partial<RineStream> = isServerFrame(frame) ? { lastFrameAt: now } : {}
  let event: StreamEvent | null = null
  if (frame.kind === 'heartbeat' || frame.kind === 'message') {
    run.liveSince ??= now
    if (phase !== 'live') patch.phase = 'live'
  }
  if (frame.kind === 'lifecycle') {
    if (frame.state === 'connecting' || frame.state === 'reconnecting') {
      run.isConnected = false
      run.isCatchUp = false
      run.settleAt = null
      if (phase !== 'connecting' && phase !== 'stale') {
        run.connectingSince = now
        patch.phase = 'connecting'
      }
    } else if (frame.state === 'connected') {
      run.isConnected = true
      run.connectedAt ??= now
      run.settleAt = now + TIMING.settleMs
      run.isCatchUp = !isSettled
    }
  }
  if (frame.kind === 'message') {
    if (run.isCatchUp) run.settleAt = now + TIMING.settleMs
    event = { kind: 'message', message: frame.message, isBacklog: run.isCatchUp }
  }
  return { patch, event, isSettle: frame.kind === 'heartbeat' }
}
