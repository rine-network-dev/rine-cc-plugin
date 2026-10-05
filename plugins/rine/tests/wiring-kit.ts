import type { On } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'
import type { RineEntry } from '../types/index'
import { heartbeatLine, lifecycleLine, messageLine } from './frame-lines'
import { tick } from './tick'

export const T0 = 1_700_000_000_000
export const CFG = '/cfg'
export const OWN_ID = 'agent-own'
export const OWN_HANDLE = 'alice@acme.rine.network'
export const BOB = 'bob@acme.rine.network'
/** The id and sender `frame-lines.ts` `messageLine` carries by default; `rine read` accepts only hex ids. */
export const MSG_ID = 'aaaaaaaa-0001'
export const VERIFIED_BOB = JSON.stringify({ verification_status: 'verified', from_agent_id: 'agent-b', decrypted_payload: { text: 'hello there' } })
export const BAND_PROPS = { bodyColumns: 100, maxRows: 8, hasSurvey: false } as const
export const PANE_PROPS = { title: 'rine', isFocused: true, bodyColumns: 100 } as const

/** Everything beneath the plugin in one test, in memory. The kit has no `session.append`, so notify rows reject and are
 * caught: assert toasts, state and the status line, never a row's text. */
export type World = {
  files: Map<string, string>
  state: Map<string, unknown>
  clock: ReturnType<typeof mock.clock>
  runs: string[][]
  spawns: { argv: readonly string[]; env: Record<string, string> | undefined }[]
  toasts: string[]
  statuses: (string | undefined)[]
  submits: { text: string; origin: unknown }[]
  opens: unknown[]
  logs: string[]
  /** Writes stdout text into the running stream child. */
  push: (text: string) => void
  /** What `rine --json read <id>` answers; null means exit code 1. */
  readAnswer: { value: string | null }
  /** Set to make `prompt.submit` answer `{ drop }`. */
  submitDrop: { reason: string } | null
  /** Set to make every `fs.write` throw. */
  isWriteFailing: boolean
  isCwdFailing: boolean
  isInteractive: boolean
}

export type WorldOptions = {
  files?: Record<string, string>
  state?: Record<string, unknown>
  store?: Record<string, unknown>
  env?: Record<string, string>
  isInteractive?: boolean
  /** `process.run` rejects, as a host with no CLI does. */
  isRunFailing?: boolean
}

/** A handler that records an event's `text` and answers with nothing. */
const recorder = (list: (string | undefined)[]) => async (_$: unknown, e: { text?: string }) => {
  list.push(e.text)
  return { value: undefined } as never
}

const slot = (e: { key: string; id?: string }): string => (e.id === undefined ? e.key : `${e.key}:${e.id}`)

export function newWorld(on: On, options: WorldOptions = {}): World {
  const files = new Map<string, string>(Object.entries({ [`${CFG}/credentials.json`]: '{}', ...options.files }))
  const world: World = {
    files,
    state: new Map(Object.entries(options.state ?? {})),
    clock: mock.clock(on, { now: T0 }),
    runs: [], spawns: [], toasts: [], statuses: [], submits: [], opens: [], logs: [],
    push: () => undefined,
    readAnswer: { value: null },
    submitDrop: null,
    isWriteFailing: false,
    isCwdFailing: false,
    isInteractive: options.isInteractive ?? true
  }
  mock.store(on, options.store)
  mock.env(on, { RINE_CONFIG_DIR: CFG, HOME: '/home/u', CLAUDE_CONFIG_DIR: '/home/u/.claude', ...options.env })
  on('state.get', async (_$, e) => ({ value: { value: world.state.get(slot(e)), version: 1 } }) as never)
  on('state.set', async (_$, e) => {
    world.state.set(slot(e), e.value)
    return { value: { isSet: true, version: 2 } } as never
  })
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }) as never)
  on('fs.read', async (_$, e) => ({ value: files.get(e.path) ?? '' }) as never)
  on('fs.write', async (_$, e) => {
    if (world.isWriteFailing) throw new Error('EROFS')
    files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('fs.stat', async (_$, e) => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }) as never)
  on('process.run', async (_$, e) => {
    world.runs.push([...e.argv])
    if (options.isRunFailing) throw new Error('spawn rine ENOENT')
    const identity = JSON.stringify({ agent: OWN_HANDLE, agent_id: OWN_ID })
    const out = e.argv.includes('--version') ? '0.20.0\n' : e.argv.includes('whoami') ? identity : e.argv.includes('read') ? world.readAnswer.value : ''
    return { value: { exitCode: out === null ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  const queue: { stream: 'stdout' | 'stderr'; text: string }[] = []
  let wake: (() => void) | null = null
  world.push = (text) => {
    queue.push({ stream: 'stdout', text })
    wake?.()
  }
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[]; env?: Record<string, string> }) {
    world.spawns.push({ argv: e.argv, env: e.env })
    for (;;) {
      while (queue.length > 0) yield queue.shift() as never
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } as never)
  on('session.start', async () => ({ cwd: '/proj' }) as never)
  on('session.end', async () => ({ sessionId: 'session-1' }) as never)
  on('tool.call', async () => ({ result: 'done' }) as never)
  on('session.id', async () => ({ value: 'session-1' }) as never)
  on('session.cwd', async () => {
    if (world.isCwdFailing) throw new Error('EIO')
    return { value: '/proj' } as never
  })
  on('session.messages', async () => ({ value: [] }) as never)
  on('prompt.compose', async () => ({ sections: [] }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('classic.UserPromptSubmit', async () => ({}) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('mcp.call', async () => ({ value: { content: [], isError: false } }) as never)
  on('ui.open', async (_$, e) => {
    world.opens.push(e)
    return { value: { isPlaced: true } } as never
  })
  on('ui.status', recorder(world.statuses))
  on('ui.toast', recorder(world.toasts))
  on('ui.log', recorder(world.logs))
  on('prompt.submit', async (_$, e) => {
    world.submits.push({ text: e.text, origin: e.origin })
    return (world.submitDrop === null ? { text: e.text } : { drop: world.submitDrop.reason }) as never
  })
  return world
}

/** Moves the mock clock in 100 ms steps until `check` holds: the plugin's waits (read-back, timers) only fire as it moves. */
export async function until(world: World, check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (check()) return
    await world.clock.advance(100)
    await tick()
  }
  const { runs, logs, toasts } = world
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify({ runs, logs, toasts, mode: world.state.get('mode'), stream: world.state.get('stream') })}`)
}

/** Awaits a call that sleeps on the mock clock (a list write's read-back), moving the clock until it settles. */
export async function drive<T>(world: World, work: Promise<T>): Promise<T> {
  let isDone = false
  const guarded = work.finally(() => {
    isDone = true
  })
  await until(world, () => isDone, 'the call to settle')
  return guarded
}

/** `session.start` alone: for sessions that never reach a stream (headless, unregistered, mcp-only). */
export function begin($: Engine, world: World): Promise<unknown> {
  return $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: world.isInteractive } as never)
}

/** `session.start` in a ready session, then waits for the stream spawn. */
export async function start($: Engine, world: World): Promise<void> {
  await begin($, world)
  if (world.isInteractive) await until(world, () => world.spawns.length > 0, 'the stream spawn')
}

/** The ledger entries the plugin has published to `$.state`. */
export const entriesOf = (world: World): RineEntry[] => (world.state.get('entries') as RineEntry[] | undefined) ?? []

export const streamPhase = (world: World): string | undefined => (world.state.get('stream') as { phase: string } | undefined)?.phase

/** `connected` plus the first heartbeat settles the startup backlog: later frames are live ones. */
export async function goLive(world: World): Promise<void> {
  world.push(lifecycleLine('connected') + heartbeatLine())
  await until(world, () => streamPhase(world) === 'live', 'a live stream')
}

/** `/rine <args>` typed by the person (origin `composer`). */
export function rine($: Engine, world: World, args: string, origin: { kind: string } = { kind: 'composer' }): Promise<unknown> {
  return drive(world, $.command.run({ command: 'rine', args, origin, presentation: 'text' } as never))
}

/** Preview on, bob allowed and verified, one message from him held for review; the first toast has appeared. */
export async function holdMessage($: Engine, world: World): Promise<void> {
  world.readAnswer.value = VERIFIED_BOB
  await start($, world)
  await goLive(world)
  await rine($, world, `allow add ${BOB}`)
  await rine($, world, 'preview on')
  world.push(messageLine({ id: MSG_ID }))
  await until(world, () => world.toasts.length > 0, 'the held toast')
}
