import type { RineStream } from '../types/index'
import { createSupervisor, type Supervisor } from '../hooks/lib/supervisor'
import type { SpawnChunk, SpawnStream, StreamEvent } from '../hooks/lib/supervisor-run'
import { at } from './at'
import { createKit, type Kit } from './kit'

export type FakeChild = SpawnStream & {
  write: (text: string, stream?: SpawnChunk['stream']) => void
  exit: () => void
  /** Set when the supervisor called return(). Like the engine's stream, return() does not end a pending next(). */
  isReturned: boolean
}

export function createChild(): FakeChild {
  const queue: SpawnChunk[] = []
  let waiter: ((result: IteratorResult<SpawnChunk, unknown>) => void) | null = null
  let isEnded = false
  const wake = (): void => {
    if (waiter === null) return
    if (queue.length > 0) {
      const resolve = waiter
      waiter = null
      resolve({ done: false, value: queue.shift() as SpawnChunk })
    } else if (isEnded) {
      const resolve = waiter
      waiter = null
      resolve({ done: true, value: undefined })
    }
  }
  const child: FakeChild = {
    isReturned: false,
    next: () =>
      new Promise((resolve) => {
        waiter = resolve
        wake()
      }),
    return: async () => {
      child.isReturned = true
      return undefined
    },
    write: (text, stream = 'stdout') => {
      queue.push({ stream, text })
      wake()
    },
    exit: () => {
      isEnded = true
      wake()
    }
  }
  return child
}

export type StreamRig = {
  kit: Kit
  supervisor: Supervisor
  children: FakeChild[]
  spawns: { argv: readonly string[]; env: Record<string, string> }[]
  published: RineStream[]
  events: StreamEvent[]
  logs: string[]
  isSpawnFailing: boolean
  stream: () => RineStream
  step: (ms: number) => Promise<void>
}

export function createStreamRig(): StreamRig {
  const kit = createKit()
  const children: FakeChild[] = []
  const spawns: StreamRig['spawns'] = []
  const published: RineStream[] = []
  const events: StreamEvent[] = []
  const logs: string[] = []
  const rig: StreamRig = {
    kit,
    children,
    spawns,
    published,
    events,
    logs,
    isSpawnFailing: false,
    supervisor: createSupervisor(
      kit.ports,
      {
        spawn: (argv, env) => {
          spawns.push({ argv, env })
          if (rig.isSpawnFailing) throw new Error('spawn rine ENOENT')
          const child = createChild()
          children.push(child)
          return child
        },
        after: (ms, fn) => {
          let isLive = true
          void kit.clock.sleep(ms).then(() => {
            if (isLive) fn()
          })
          return () => {
            isLive = false
          }
        },
        publish: (stream) => {
          published.push(stream)
        },
        emit: (event) => {
          events.push(event)
        },
        log: (text) => {
          logs.push(text)
        }
      },
      '/cfg'
    ),
    stream: () => at(published, published.length - 1),
    step: (ms) => kit.clock.step(ms)
  }
  return rig
}

export async function startedRig(): Promise<StreamRig> {
  const rig = createStreamRig()
  rig.supervisor.start()
  await rig.step(0)
  return rig
}

/** Lets the supervisor's pending retry timer fire exactly: the next child exists afterwards. */
export async function runRetry(rig: StreamRig): Promise<void> {
  const retryAt = rig.stream().nextRetryAt as number
  await rig.step(retryAt - (await rig.kit.clock.now()))
}

/** Ends the first `count` children in turn, waiting out each backoff. */
export async function failChildren(rig: StreamRig, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    at(rig.children, i).exit()
    await rig.step(0)
    await runRetry(rig)
  }
}
