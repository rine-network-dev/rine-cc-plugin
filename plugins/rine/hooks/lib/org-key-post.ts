import type { KeyEvent } from './org-keys'
import type { OrgVi } from './org-window'

/** What the surface module posts: an epoch naming that instance, and its latest keys, each with a sequence number. */
export type KeyPost = { epoch: string; keys: { seq: number; event: KeyEvent }[] }

const MAX_POSTED_KEYS = 64
const MAX_EPOCH_CHARS = 64
const MAX_KEY_CHARS = 16

/** Reads a post from the surface module as untrusted data; null when it is not a key post. */
export function parseKeyPost(data: unknown): KeyPost | null {
  const { epoch, keys } = (typeof data === 'object' && data !== null ? data : {}) as { epoch?: unknown; keys?: unknown }
  if (typeof epoch !== 'string' || epoch === '' || epoch.length > MAX_EPOCH_CHARS) return null
  if (!Array.isArray(keys) || keys.length > MAX_POSTED_KEYS) return null
  const taken: KeyPost['keys'] = []
  for (const one of keys) {
    const { seq, key, ctrl, meta } = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
    if (!Number.isSafeInteger(seq) || typeof key !== 'string' || key === '' || key.length > MAX_KEY_CHARS) return null
    taken.push({ seq: seq as number, event: { key, ctrl: ctrl === true, meta: meta === true } })
  }
  return { epoch, keys: taken }
}

/**
 * The keys of a post not taken before, oldest first, and the cursor moved past them. Posts repeat the latest keys, so a post
 * the host never received loses none; a new epoch is a new surface instance and starts over.
 */
export function takeNewKeys(vi: OrgVi, post: KeyPost): { keys: KeyEvent[]; vi: OrgVi } {
  const seen = post.epoch === vi.epoch ? vi.seq : 0
  const fresh = post.keys.filter((one) => one.seq > seen).sort((a, b) => a.seq - b.seq)
  return { keys: fresh.map((one) => one.event), vi: { ...vi, epoch: post.epoch, seq: fresh.reduce((top, one) => Math.max(top, one.seq), seen) } }
}
