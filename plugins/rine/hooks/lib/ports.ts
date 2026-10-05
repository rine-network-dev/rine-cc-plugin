export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type RunInit = { timeoutMs?: number; env?: Record<string, string> }
export type RunPort = (argv: readonly string[], init?: RunInit) => Promise<RunResult>

export type FsPort = {
  /** The file's text, or undefined when it is missing. */
  read: (path: string) => Promise<string | undefined>
  write: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

export type ClockPort = {
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
}

/** `entered` is the text that reached the model, after any other plugin's `prompt.submit` rewrite. */
export type SubmitResult = { isDropped: false; entered: string } | { isDropped: true; reason: string }

export type Sink = {
  /** Appends a user-role notify row. Resolves the row index (the `$.session.messages({ as: 'api' })` length right after it, the count a `turn.step` reports), or null when the engine refused or rejected it. */
  append: (text: string) => Promise<number | null>
  /** Submits a wake or hand-off prompt. A rejection reads as dropped. */
  submit: (text: string) => Promise<SubmitResult>
  toast: (text: string) => void
  /** Appends a system notice row, never read by the model. */
  notice: (text: string) => Promise<void>
}

export type Ports = {
  fs: FsPort
  clock: ClockPort
  random: () => number
  run: RunPort
  sink: Sink
}

export const RUNS_PER_MINUTE = 6

export function limitRuns(run: RunPort, clock: ClockPort, perMinute: number): RunPort {
  const starts: number[] = []
  return async (argv, init) => {
    for (;;) {
      const now = await clock.now()
      const cutoff = now - 60000
      let oldest = starts[0]
      while (oldest !== undefined && oldest <= cutoff) {
        starts.shift()
        oldest = starts[0]
      }
      if (starts.length < perMinute) {
        starts.push(now)
        return run(argv, init)
      }
      const wait = (oldest ?? now) + 60000 - now
      await clock.sleep(wait < 1 ? 1 : wait)
    }
  }
}

/**
 * What the engine offers, as plain functions. The validator follows `$` only inside the module file's own
 * functions, so `register.tsx` builds this from `$` and hands it to `portsFrom`.
 */
export type Backend = {
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string>
  writeText: (path: string, text: string) => Promise<void>
  run: RunPort
  append: (type: 'user' | 'system', text: string) => Promise<{ isDenied: boolean }>
  messageCount: () => Promise<number>
  /** Resolves the engine's drop reason, or the text that entered when the prompt was accepted. */
  submit: (text: string) => Promise<{ drop: string } | { entered: string }>
  toast: (text: string) => void
  log: (text: string) => void
}

async function appendRow(b: Backend, type: 'user' | 'system', text: string): Promise<number | null> {
  try {
    if ((await b.append(type, text)).isDenied) return null
    return await b.messageCount()
  } catch (err) {
    b.log('rine: append failed: ' + (err instanceof Error ? err.name : 'error'))
    return null
  }
}

export function portsFrom(b: Backend): Ports {
  const clock: ClockPort = { now: b.now, sleep: b.sleep }
  const fs: FsPort = {
    read: async (path) => ((await b.exists(path)) ? b.readText(path) : undefined),
    write: b.writeText,
    exists: b.exists
  }
  const sink: Sink = {
    append: (text) => appendRow(b, 'user', text),
    submit: async (text) => {
      try {
        const outcome = await b.submit(text)
        return 'drop' in outcome ? { isDropped: true, reason: outcome.drop } : { isDropped: false, entered: outcome.entered }
      } catch {
        return { isDropped: true, reason: 'error' }
      }
    },
    toast: b.toast,
    notice: async (text) => {
      await appendRow(b, 'system', text)
    }
  }
  return { fs, clock, random: Math.random, run: limitRuns(b.run, clock, RUNS_PER_MINUTE), sink }
}
