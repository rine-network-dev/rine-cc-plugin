import { RENEW_EVERY_MS } from '../lib/lease'
import { markRead } from '../lib/ledger'
import { detectMode } from '../lib/mode'
import { portsFrom } from '../lib/ports'
import { submitRequest, type RequestKind } from '../lib/requests'
import type { Core, Live } from './core'
import type { Cancel, Host, StartInfo } from './host'
import type { Memory } from './memory'
import { buildLive } from './live'
import { tick } from './tick'

const TICK_MS = 5000
const REDETECT_MS = 30000

export type Session = {
  core: Core
  /** Records the session's facts and boots once; a later call only retries what is missing. */
  start: (info: StartInfo) => void
  /** Boots again when the mode is not `ready` or the identity is unknown (D:R-j), at most every 30 s. */
  ensure: () => void
  /** `session.end`: stops the stream and releases the lease with one write. */
  stop: () => Promise<void>
  takeover: () => Promise<boolean>
  reconnect: () => void
  markRead: (ids: readonly string[]) => Promise<void>
  ask: (kind: RequestKind, ids: readonly string[]) => Promise<void>
}

export function createSession(host: Host, mem: Memory): Session {
  const ports = portsFrom(host.backend)
  const log = host.backend.log
  const timers: Cancel[] = []
  let live: Live | null = null
  let info: StartInfo | null = null
  let isBooting = false
  let isEnded = false
  let isStepping = false
  let lastTryAt = 0
  const core: Core = { host, ports, mem, live: () => live }

  const detached = (job: () => Promise<void>): (() => void) => () => {
    void job().catch(() => log('rine: background step failed'))
  }

  const becomePeer = async (l: Live): Promise<void> => {
    const read = await l.lease.read()
    const ownerCwd = read.status === 'ok' ? read.lease.cwd : null
    const { stream } = mem.get()
    if (stream.phase !== 'peer' || stream.ownerCwd !== ownerCwd) l.supervisor.stop('peer', ownerCwd)
    mem.set({ isOwner: false })
  }

  const own = async (l: Live): Promise<void> => {
    mem.set({ isOwner: true })
    l.supervisor.start()
    if (mem.get().identity.isStateWritable) await l.writer.flush()
  }

  const leaseStep = async (l: Live): Promise<void> => {
    if (isStepping || !mem.get().identity.isStateWritable) return
    isStepping = true
    try {
      if (!mem.get().isOwner) {
        await ((await l.lease.contend()) ? own(l) : becomePeer(l))
      } else if ((await l.lease.renew()) === 'lost') {
        l.writer.cancel()
        await becomePeer(l)
      }
    } finally {
      isStepping = false
    }
  }

  const begin = async (agentId: string, cwd: string): Promise<void> => {
    const l = await buildLive(core, mem.get().identity, agentId, cwd)
    live = l
    timers.push(host.every(RENEW_EVERY_MS, detached(() => leaseStep(l))))
    const isFree = !mem.get().identity.isStateWritable || (await l.lease.acquire())
    await (isFree ? own(l) : becomePeer(l))
  }

  const boot = async (): Promise<void> => {
    if (info === null || isBooting || isEnded || live !== null) return
    isBooting = true
    lastTryAt = await ports.clock.now()
    try {
      mem.set({ isDetecting: info.isInteractive })
      const { cwd, isInteractive } = info
      const env = { rineConfigDir: await host.env('rineConfigDir'), home: await host.env('home'), cwd, isInteractive }
      const detected = await detectMode(ports, env)
      mem.set({ ...detected, isDetecting: false })
      const agentId = detected.identity.agentId
      if (detected.mode === 'ready' && agentId !== null) await begin(agentId, cwd)
    } finally {
      isBooting = false
      if (mem.get().isDetecting) mem.set({ isDetecting: false })
    }
  }

  const ensure = (): void => {
    if (info === null || live !== null || mem.get().mode === 'headless') return
    detached(async () => {
      if ((await ports.clock.now()) - lastTryAt >= REDETECT_MS) await boot()
    })()
  }

  const ask = async (kind: RequestKind, ids: readonly string[]): Promise<void> => {
    const l = live
    const m = mem.get()
    if (l === null) return
    if (m.isOwner) return l.changed()
    if (!m.identity.isStateWritable) return
    for (const id of ids) await submitRequest(ports, l.rineDir, kind, id, m.appliedRequests)
  }

  return {
    core,
    start: (next) => {
      info = next
      if (timers.length > 0) return ensure()
      timers.push(host.every(TICK_MS, detached(async () => { ensure(); await tick(core) })))
      detached(async () => {
        const recalled = await host.recall()
        mem.set({
          entries: recalled.entries ?? [],
          mirrorSince: recalled.mirrorSince ?? (await ports.clock.now()),
          leaseNonce: recalled.leaseNonce ?? null,
          permissionMode: recalled.permissionMode ?? null
        })
        await boot()
      })()
    },
    ensure,
    stop: async () => {
      isEnded = true
      for (const cancel of timers.splice(0)) cancel()
      const l = live
      if (l === null) return
      l.writer.cancel()
      l.supervisor.stop('off')
      if (mem.get().isOwner && mem.get().identity.isStateWritable) await l.lease.release()
      mem.set({ isOwner: false })
    },
    takeover: async () => {
      const l = live
      if (l === null || !(await l.lease.takeover())) return false
      if (!mem.get().isOwner) await own(l)
      return true
    },
    reconnect: () => {
      if (live === null) {
        lastTryAt = 0
        return ensure()
      }
      if (mem.get().isOwner) live.supervisor.reconnect()
    },
    markRead: async (ids) => {
      mem.set({ entries: markRead(mem.get().entries, ids) })
      await ask('read', ids)
    },
    ask
  }
}
