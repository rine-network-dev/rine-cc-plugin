import type { RineEntry, RineIdentity, RineMode, RinePrefs, RineStream } from '../../types/index'
import { EMPTY_VIEW, type ListsView } from '../lib/lists'
import { DEFAULT_PREFS } from '../lib/prefs'
import type { Published } from './host'

/** What the runtime decides from. The `SHARED` part is mirrored into `$.state` for the drawings. */
export type Mem = {
  mode: RineMode
  identity: RineIdentity
  stream: RineStream
  entries: RineEntry[]
  prefs: RinePrefs
  lists: ListsView
  isOwner: boolean
  isBusy: boolean
  pendingWake: boolean
  wakeCooldownUntil: number | null
  permissionMode: string | null
  mirrorSince: number
  leaseNonce: string | null
  isDetecting: boolean
  isLegacyPaused: boolean
  wokeAt: number | null
  appliedRequests: string[]
}

export type Memory = { get: () => Mem; set: (patch: Partial<Mem>) => void }

const SHARED = ['mode', 'identity', 'stream', 'entries', 'prefs', 'isOwner', 'isLegacyPaused', 'isBusy', 'pendingWake', 'wakeCooldownUntil', 'permissionMode', 'mirrorSince', 'leaseNonce'] as const satisfies readonly (keyof Published)[]

export const OFF_STREAM: RineStream = { phase: 'off', attempt: 0, lastFrameAt: null, nextRetryAt: null, ownerCwd: null, unreadable: 0 }

export function initialMem(): Mem {
  return {
    mode: 'headless',
    identity: { handle: null, agentId: null, configDir: '', cliVersion: null, isBelowFloor: false, isStateWritable: true },
    stream: OFF_STREAM,
    entries: [],
    prefs: DEFAULT_PREFS,
    lists: EMPTY_VIEW,
    isOwner: false,
    isBusy: false,
    pendingWake: false,
    wakeCooldownUntil: null,
    permissionMode: null,
    mirrorSince: 0,
    leaseNonce: null,
    isDetecting: false,
    isLegacyPaused: false,
    wokeAt: null,
    appliedRequests: []
  }
}

/** Memory is the working copy; each change reaches `$.state` in order, and a failed write is logged, never thrown. */
export function createMemory(mem: Mem, publish: (patch: Published) => Promise<void>, log: (text: string) => void): Memory {
  let tail: Promise<void> = Promise.resolve()
  return {
    get: () => mem,
    set: (patch) => {
      Object.assign(mem, patch)
      const out: Record<string, unknown> = {}
      for (const key of SHARED) if (key in patch) out[key] = mem[key]
      if ('lists' in patch) Object.assign(out, { lists: mem.lists.lists, listsDigest: mem.lists.digest, isListsTrusted: mem.lists.isTrusted })
      if (Object.keys(out).length === 0) return
      tail = tail.then(() => publish(out as Published)).catch(() => log('rine: state write failed'))
    }
  }
}
