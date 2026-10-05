import { open, readSealed, writeSealed } from './envelope'
import { isRecord } from './narrow'
import type { Ports } from './ports'
import { statePath } from './refs'

export const LEASE_TTL_MS = 30000
export const RENEW_EVERY_MS = 10000
export const WAKE_SPACING_MS = 30000
export const WAKES_PER_HOUR = 12

const UNKNOWN_FREE_MS = 30000
const SETTLE_MS = 500
const TAKEOVER_SETTLE_MS = 1000
const CONTEND_JITTER_MS = 2000
const HOUR_MS = 3600000

export type LeaseRecord = {
  nonce: string
  agentId: string
  sessionId: string
  cwd: string
  heartbeatAt: number
  releasedAt: number | null
  wakes: number[]
}
export type LeaseRead = { status: 'absent' } | { status: 'unknown' } | { status: 'ok'; lease: LeaseRecord }
export type LeaseConfig = { rineDir: string; nonce: string; agentId: string; sessionId: string; cwd: string }

export type Lease = {
  isOwner: () => boolean
  read: () => Promise<LeaseRead>
  /** Writes our nonce if the lease is free, then reads back to confirm it took. */
  acquire: () => Promise<boolean>
  /** A non-owner's 10 s step: when the lease is free, waits 0-2 s at random, then acquires. */
  contend: () => Promise<boolean>
  /** The owner's 10 s step; `lost` once a read shows another nonce, which the caller answers with a step down. */
  renew: () => Promise<'owned' | 'lost'>
  /** Writes our nonce unconditionally, re-reads after 1 s, and rewrites once if a renew race overwrote it. */
  takeover: () => Promise<boolean>
  /** One read and one write, no sleep and no read-back. */
  release: () => Promise<void>
  /** The pre-wake check: the file still shows our nonce. */
  isStillOwner: () => Promise<boolean>
  wakes: () => number[]
  /** Records the stamp and writes it to the file at once, so a crash or step-down cannot drop it. */
  recordWake: (at: number) => Promise<void>
}

export function newNonce(random: () => number): string {
  const word = (): string => Math.floor(random() * 0x100000000).toString(16).padStart(8, '0')
  return word() + word() + word() + word()
}

/** One wake per 30 s and 12 per rolling hour. */
export function isWakeAllowed(wakes: readonly number[], now: number): boolean {
  const last = wakes.reduce((latest, at) => Math.max(latest, at), 0)
  if (now - last < WAKE_SPACING_MS) return false
  return wakes.filter((at) => now - at < HOUR_MS).length < WAKES_PER_HOUR
}

function recent(wakes: readonly number[], now: number): number[] {
  return wakes.filter((at) => now - at < HOUR_MS)
}

function normalizeLease(value: unknown): LeaseRecord | null {
  if (!isRecord(value)) return null
  const { nonce, agentId, sessionId, cwd, heartbeatAt, releasedAt, wakes } = value
  if (typeof nonce !== 'string' || typeof agentId !== 'string' || typeof sessionId !== 'string') return null
  if (typeof cwd !== 'string' || typeof heartbeatAt !== 'number') return null
  if (releasedAt !== null && typeof releasedAt !== 'number') return null
  const stamps = Array.isArray(wakes) ? wakes.filter((at): at is number => typeof at === 'number') : []
  return { nonce, agentId, sessionId, cwd, heartbeatAt, releasedAt, wakes: stamps }
}

async function parseLease(text: string): Promise<LeaseRecord | null> {
  const body = await open(text)
  if (body === null) return null
  try {
    return normalizeLease(JSON.parse(body))
  } catch {
    return null
  }
}

export function createLease(ports: Pick<Ports, 'fs' | 'clock' | 'random'>, config: LeaseConfig): Lease {
  const path = statePath(config.rineDir, 'lease')
  let isOwned = false
  let wakes: number[] = []
  let unknownSince: number | null = null

  async function read(): Promise<LeaseRead> {
    const sealed = await readSealed(ports, path)
    const lease = sealed.status === 'ok' ? normalizeLease(sealed.value) : null
    if (lease !== null) {
      unknownSince = null
      return { status: 'ok', lease }
    }
    if (sealed.status === 'absent') {
      unknownSince = null
      return { status: 'absent' }
    }
    unknownSince ??= await ports.clock.now()
    return { status: 'unknown' }
  }

  function isFree(current: LeaseRead, now: number): boolean {
    if (current.status === 'absent') return true
    if (current.status === 'unknown') return unknownSince !== null && now - unknownSince >= UNKNOWN_FREE_MS
    const { lease } = current
    return lease.nonce === config.nonce || lease.releasedAt !== null || now - lease.heartbeatAt > LEASE_TTL_MS
  }

  function isOurs(current: LeaseRead): boolean {
    return current.status === 'ok' && current.lease.nonce === config.nonce
  }

  async function writeOurs(base: LeaseRead): Promise<void> {
    const now = await ports.clock.now()
    const carried = base.status === 'ok' ? base.lease.wakes : []
    wakes = recent([...new Set([...wakes, ...carried])], now)
    const { nonce, agentId, sessionId, cwd } = config
    const record: LeaseRecord = { nonce, agentId, sessionId, cwd, heartbeatAt: now, releasedAt: null, wakes }
    await writeSealed(ports, path, record)
  }

  async function acquire(): Promise<boolean> {
    const current = await read()
    if (!isFree(current, await ports.clock.now())) return false
    await writeOurs(current)
    await ports.clock.sleep(SETTLE_MS)
    isOwned = isOurs(await read())
    return isOwned
  }

  async function renew(): Promise<'owned' | 'lost'> {
    if (!isOwned) return 'lost'
    const current = await read()
    if (current.status === 'unknown') return 'owned'
    if (current.status === 'ok' && !isOurs(current)) {
      isOwned = false
      return 'lost'
    }
    await writeOurs(current)
    await ports.clock.sleep(SETTLE_MS)
    const back = await read()
    isOwned = back.status !== 'ok' || isOurs(back)
    return isOwned ? 'owned' : 'lost'
  }

  async function takeover(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await writeOurs(await read())
      await ports.clock.sleep(TAKEOVER_SETTLE_MS)
      if (isOurs(await read())) {
        isOwned = true
        return true
      }
    }
    isOwned = false
    return false
  }

  async function release(): Promise<void> {
    if (!isOwned) return
    isOwned = false
    const text = await ports.fs.read(path)
    const lease = text === undefined ? null : await parseLease(text)
    if (lease === null || lease.nonce !== config.nonce) return
    const now = await ports.clock.now()
    await writeSealed(ports, path, { ...lease, releasedAt: now, wakes: recent(wakes, now) })
  }

  return {
    isOwner: () => isOwned,
    read,
    acquire,
    renew,
    takeover,
    release,
    contend: async () => {
      if (!isFree(await read(), await ports.clock.now())) return false
      await ports.clock.sleep(Math.floor(ports.random() * CONTEND_JITTER_MS))
      return acquire()
    },
    isStillOwner: async () => {
      const current = await read()
      return isOwned && current.status === 'ok' && current.lease.nonce === config.nonce && current.lease.releasedAt === null
    },
    wakes: () => [...wakes],
    recordWake: async (at) => {
      wakes = [...recent(wakes, at), at]
      try {
        const current = await read()
        if (isOwned && isOurs(current)) await writeOurs(current)
      } catch {
        // The stamp stays in memory, and the next renew writes it.
      }
    }
  }
}
