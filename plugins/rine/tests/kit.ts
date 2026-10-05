import type { ClockPort, FsPort, Ports, RunPort, RunResult, Sink, SubmitResult } from '../hooks/lib/ports'
import { tick } from './tick'

export type MemFs = FsPort & {
  files: Map<string, string>
  isWriteFailing: boolean
  injectReads: (path: string, texts: string[]) => void
}

export type ManualClock = ClockPort & {
  advance: (ms: number) => Promise<void>
  step: (ms: number) => Promise<void>
  settle: <T>(work: Promise<T>, stepMs?: number) => Promise<T>
}

export type SinkCall = { kind: 'append' | 'submit' | 'toast' | 'notice'; text: string }

export type RecordingSink = Sink & {
  calls: SinkCall[]
  textsOf: (kind: SinkCall['kind']) => string[]
  /** null accepts the prompt unchanged; set a result to drop it or to model another plugin's rewrite. */
  submitResult: SubmitResult | null
  isAppendFailing: boolean
}

export type RunHandler = (argv: readonly string[]) => RunResult | Error | Promise<RunResult | Error>

export type Kit = {
  ports: Ports
  fs: MemFs
  clock: ManualClock
  sink: RecordingSink
  runs: string[][]
  setRun: (handler: RunHandler) => void
}

export type KitOptions = { fs?: MemFs; clock?: ManualClock; seed?: number; now?: number }

type Sleeper = { deadline: number; resolve: () => void }

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function takeDue(sleepers: Sleeper[], target: number): Sleeper | undefined {
  let due: Sleeper | undefined
  for (const sleeper of sleepers) {
    if (sleeper.deadline <= target && (due === undefined || sleeper.deadline < due.deadline)) due = sleeper
  }
  if (due === undefined) return undefined
  sleepers.splice(sleepers.indexOf(due), 1)
  return due
}

function createMemFs(): MemFs {
  const files = new Map<string, string>()
  const injected = new Map<string, string[]>()
  const fs: MemFs = {
    files,
    isWriteFailing: false,
    injectReads: (path, texts) => {
      injected.set(path, [...texts])
    },
    read: async (path) => {
      const queue = injected.get(path)
      if (queue !== undefined && queue.length > 0) return queue.shift()
      return files.get(path)
    },
    write: async (path, text) => {
      if (fs.isWriteFailing) throw new Error('EACCES')
      files.set(path, text)
    },
    exists: async (path) => files.has(path)
  }
  return fs
}

function createManualClock(start: number): ManualClock {
  let t = start
  const sleepers: Sleeper[] = []
  const clock: ManualClock = {
    now: async () => t,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleepers.push({ deadline: t + ms, resolve })
      }),
    advance: async (ms) => {
      await flush()
      const target = t + ms
      for (;;) {
        const due = takeDue(sleepers, target)
        if (due === undefined) break
        t = due.deadline
        due.resolve()
        await flush()
      }
      t = target
      await flush()
    },
    step: async (ms) => {
      await clock.advance(ms)
      await tick()
      await clock.advance(0)
    },
    settle: async <T>(work: Promise<T>, stepMs = 50): Promise<T> => {
      const state: { done: boolean; ok: boolean; value?: T; error?: unknown } = { done: false, ok: false }
      work.then(
        (value) => {
          state.done = true
          state.ok = true
          state.value = value
        },
        (error) => {
          state.done = true
          state.error = error
        }
      )
      for (let i = 0; i < 2000 && !state.done; i++) {
        await clock.advance(stepMs)
        await tick()
      }
      if (!state.done) throw new Error('settle: still pending')
      if (!state.ok) throw state.error
      return state.value as T
    }
  }
  return clock
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a += 0x6d2b79f5
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createSink(): RecordingSink {
  const calls: SinkCall[] = []
  let appended = 0
  const sink: RecordingSink = {
    calls,
    submitResult: null,
    isAppendFailing: false,
    textsOf: (kind) => calls.filter((call) => call.kind === kind).map((call) => call.text),
    append: async (text) => {
      calls.push({ kind: 'append', text })
      if (sink.isAppendFailing) return null
      appended += 1
      return appended
    },
    submit: async (text) => {
      calls.push({ kind: 'submit', text })
      return sink.submitResult ?? { isDropped: false, entered: text }
    },
    toast: (text) => {
      calls.push({ kind: 'toast', text })
    },
    notice: async (text) => {
      calls.push({ kind: 'notice', text })
    }
  }
  return sink
}

export function createKit(options: KitOptions = {}): Kit {
  const fs = options.fs ?? createMemFs()
  const clock = options.clock ?? createManualClock(options.now ?? 1_000_000)
  const sink = createSink()
  const runs: string[][] = []
  let handler: RunHandler = () => new Error('no run handler')
  const run: RunPort = async (argv) => {
    runs.push([...argv])
    const result = await handler(argv)
    if (result instanceof Error) throw result
    return result
  }
  const ports: Ports = { fs, clock, random: mulberry32(options.seed ?? 1), run, sink }
  return {
    ports,
    fs,
    clock,
    sink,
    runs,
    setRun: (next) => {
      handler = next
    }
  }
}

export function splice(a: string, b: string): string {
  const half = Math.floor(a.length / 2)
  return a.slice(0, half) + b.slice(half)
}

export function truncated(text: string): string {
  return text.slice(0, Math.floor(text.length / 2))
}
