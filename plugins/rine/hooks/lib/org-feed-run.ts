import type { LineBuffer } from './frames'
import { createOrgLineBuffer, type OrgFrame } from './org-frames'
import { KILLED, type SpawnStream } from './supervisor-run'

/** One feed child: its line buffer and a kill that also ends a pending read, which the engine's own return() does not. */
export type Run = {
  child: SpawnStream
  buffer: LineBuffer<OrgFrame>
  isOver: boolean
  kill: () => void
  killed: Promise<typeof KILLED>
}

export function openRun(child: SpawnStream): Run {
  let resolveKilled: (value: typeof KILLED) => void = () => {}
  const killed = new Promise<typeof KILLED>((resolve) => {
    resolveKilled = resolve
  })
  const run: Run = {
    child,
    buffer: createOrgLineBuffer(),
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

/** The process's exit code from a finished stream (the engine ends it with `{ code, signal }`), or null. */
function exitCodeOf(value: unknown): number | null {
  const code = typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined
  return typeof code === 'number' ? code : null
}

/** Feeds a child's stdout lines to `onLine` until it ends; resolves its exit code, or null when killed or unreadable. */
export async function drain(
  r: Run,
  onStderr: () => Promise<void>,
  onLine: (frame: OrgFrame) => Promise<void>
): Promise<number | null> {
  for (;;) {
    let step: Awaited<ReturnType<SpawnStream['next']>> | typeof KILLED
    try {
      step = await Promise.race([r.child.next(), r.killed])
    } catch {
      return null
    }
    if (step === KILLED) return null
    if (step.done) return exitCodeOf(step.value)
    if (step.value.stream === 'stderr') {
      await onStderr()
      continue
    }
    for (const frame of r.buffer.push(step.value.text)) {
      if (r.isOver) return null
      await onLine(frame)
    }
  }
}
