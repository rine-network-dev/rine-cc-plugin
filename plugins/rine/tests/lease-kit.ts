import { seal } from '../hooks/lib/envelope'
import { createLease, type LeaseRecord } from '../hooks/lib/lease'
import { statePath } from '../hooks/lib/refs'
import { DIR } from './entry-kit'
import type { Kit } from './kit'

export const LEASE_PATH = statePath(DIR, 'lease')

export function actor(kit: Kit, nonce: string) {
  return createLease(kit.ports, { rineDir: DIR, nonce, agentId: 'agent-1', sessionId: `s-${nonce}`, cwd: '/work' })
}

/** Puts a lease of another owner on file; `over` changes any field. */
export async function put(kit: Kit, over: Partial<LeaseRecord>): Promise<void> {
  const record: LeaseRecord = {
    nonce: 'other',
    agentId: 'agent-1',
    sessionId: 's-other',
    cwd: '/work',
    heartbeatAt: await kit.ports.clock.now(),
    releasedAt: null,
    wakes: [],
    ...over
  }
  kit.fs.files.set(LEASE_PATH, await seal(JSON.stringify(record)))
}

export async function otherText(): Promise<string> {
  const record: LeaseRecord = { nonce: 'other', agentId: 'agent-1', sessionId: 's', cwd: '/work', heartbeatAt: 1, releasedAt: null, wakes: [] }
  return seal(JSON.stringify(record))
}
