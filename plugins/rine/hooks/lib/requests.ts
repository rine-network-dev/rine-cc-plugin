import { readSealed, updateSealed } from './envelope'
import { isRecord } from './narrow'
import type { Ports } from './ports'
import { statePath } from './refs'

export const REQUESTS_CAP = 200

export type RequestKind = 'read' | 'handed'
export type RineRequest = { id: string; kind: RequestKind; entryId: string; at: number }

type RequestsFile = { v: 1; requests: RineRequest[] }

function normalizeRequest(value: unknown): RineRequest | null {
  if (!isRecord(value)) return null
  const { id, kind, entryId, at } = value
  if (typeof id !== 'string' || typeof entryId !== 'string' || typeof at !== 'number') return null
  if (kind !== 'read' && kind !== 'handed') return null
  return { id, kind, entryId, at }
}

function normalizeRequests(value: unknown): RineRequest[] | null {
  if (!isRecord(value) || !Array.isArray(value.requests)) return null
  const requests: RineRequest[] = []
  for (const item of value.requests.slice(-REQUESTS_CAP)) {
    const request = normalizeRequest(item)
    if (request !== null) requests.push(request)
  }
  return requests
}

/** The requests on file. An absent or unknown file reads as none; the owner asks again in 5 s. */
export async function readRequests(ports: Pick<Ports, 'fs' | 'clock'>, rineDir: string): Promise<RineRequest[]> {
  const sealed = await readSealed(ports, statePath(rineDir, 'requests'))
  return (sealed.status === 'ok' ? normalizeRequests(sealed.value) : null) ?? []
}

/** The requests the ledger does not yet show applied. */
export function pendingRequests(requests: readonly RineRequest[], appliedIds: readonly string[]): RineRequest[] {
  return requests.filter((request) => !appliedIds.includes(request.id))
}

/**
 * A non-owner asks the owner to mark an entry read or handed. The write drops requests the ledger shows
 * applied, caps the file, and is checked by reading it back. Null when the file never held the request.
 */
export async function submitRequest(
  ports: Pick<Ports, 'fs' | 'clock' | 'random'>,
  rineDir: string,
  kind: RequestKind,
  entryId: string,
  appliedIds: readonly string[]
): Promise<RineRequest | null> {
  const at = await ports.clock.now()
  const salt = Math.floor(ports.random() * 0x100000000).toString(36)
  const request: RineRequest = { id: `${at.toString(36)}-${salt}`, kind, entryId, at }
  const outcome = await updateSealed<RequestsFile>(
    ports,
    statePath(rineDir, 'requests'),
    (current) => {
      const stored = current.status === 'ok' ? normalizeRequests(current.value) : null
      const kept = pendingRequests(stored ?? [], appliedIds).filter((other) => other.id !== request.id)
      return { v: 1, requests: [...kept, request].slice(-REQUESTS_CAP) }
    },
    (_next, stored) => (normalizeRequests(stored) ?? []).some((other) => other.id === request.id)
  )
  return outcome.status === 'ok' ? request : null
}
