import type { RineDisposition, RineEntry, RineList } from '../../types/index'
import { isRecord, nullableString } from './narrow'
import { TOOL_PATTERN } from './refs'
import type { RineRequest } from './requests'

export const LEDGER_CAP = 500

const HOUR_MS = 3600000
const READ_MAX_AGE_MS = 24 * HOUR_MS
const MAX_AGE_MS = 7 * 24 * HOUR_MS
const LISTS: readonly RineList[] = ['allow', 'deny', 'none']
const DISPOSITIONS: readonly RineDisposition[] = ['notified', 'woken', 'held', 'silent', 'backlog', 'handed']
const DISPOSITION_RANK: Record<RineDisposition, number> = {
  notified: 0,
  held: 0,
  silent: 0,
  backlog: 0,
  woken: 1,
  handed: 2
}

export type LedgerFile = { v: 1; entries: RineEntry[]; appliedRequests: string[] }
export type Counts = { unread: number; held: number; filtered: number }
export type MirrorResult = { entries: RineEntry[]; fresh: RineEntry[] }
export type BacklogSummary = { arrived: number; earlier: number; entries: RineEntry[] }
export type PruneResult = { entries: RineEntry[]; droppedHeld: number }

export const EMPTY_LEDGER: LedgerFile = { v: 1, entries: [], appliedRequests: [] }

/** The one selector the status line, band and pane share. */
export function counts(entries: readonly RineEntry[]): Counts {
  let unread = 0
  let held = 0
  let filtered = 0
  for (const entry of entries) {
    if (entry.list === 'deny') filtered += 1
    if (entry.state !== 'unread') continue
    if (entry.disposition === 'held') held += 1
    else if (entry.list !== 'deny') unread += 1
  }
  return { unread, held, filtered }
}

function normalizeEntry(value: unknown): RineEntry | null {
  if (!isRecord(value)) return null
  const group = nullableString(value.group)
  const groupId = nullableString(value.groupId)
  const conversationId = nullableString(value.conversationId)
  const encryption = nullableString(value.encryption)
  const list = LISTS.find((name) => name === value.list)
  const disposition = DISPOSITIONS.find((name) => name === value.disposition)
  const { id, from, fromAgentId, type, createdAt, receivedAt, state, rowIndex } = value
  if (typeof id !== 'string' || typeof from !== 'string' || typeof fromAgentId !== 'string') return null
  if (typeof type !== 'string' || typeof createdAt !== 'string' || typeof receivedAt !== 'number') return null
  if (group === undefined || groupId === undefined || conversationId === undefined || encryption === undefined) return null
  if (list === undefined || disposition === undefined) return null
  if (state !== 'unread' && state !== 'read') return null
  const row = typeof rowIndex === 'number' ? rowIndex : null
  const isWebhook = value.isWebhook === true
  return {
    id, from, fromAgentId, group, groupId, type, conversationId, encryption,
    createdAt, receivedAt, list, disposition, state, rowIndex: row, isWebhook
  }
}

export function normalizeLedger(value: unknown): LedgerFile | null {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.entries)) return null
  const entries: RineEntry[] = []
  for (const item of value.entries) {
    const entry = normalizeEntry(item)
    if (entry !== null) entries.push(entry)
  }
  const applied = Array.isArray(value.appliedRequests) ? value.appliedRequests : []
  return { v: 1, entries, appliedRequests: applied.filter((id): id is string => typeof id === 'string') }
}

function mergeEntry(file: RineEntry, memory: RineEntry): RineEntry {
  const winner = DISPOSITION_RANK[file.disposition] > DISPOSITION_RANK[memory.disposition] ? file : memory
  const isRead = file.state === 'read' || memory.state === 'read'
  return { ...winner, state: isRead ? 'read' : 'unread', rowIndex: memory.rowIndex ?? file.rowIndex }
}

/** Union by id, oldest first: `read` beats `unread`, and `handed`/`woken` beat `notified`/`held`. */
export function mergeEntries(file: readonly RineEntry[], memory: readonly RineEntry[]): RineEntry[] {
  const byId = new Map<string, RineEntry>()
  for (const entry of file) byId.set(entry.id, entry)
  for (const entry of memory) {
    const known = byId.get(entry.id)
    byId.set(entry.id, known === undefined ? entry : mergeEntry(known, entry))
  }
  return [...byId.values()].sort((a, b) => a.receivedAt - b.receivedAt)
}

/** What memory holds after a write: the written file plus every change made since `written`, minus what the write pruned. */
export function adoptMerged(current: readonly RineEntry[], written: readonly RineEntry[], merged: readonly RineEntry[]): RineEntry[] {
  const kept = new Set(merged.map((entry) => entry.id))
  const pruned = new Set(written.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id))
  return mergeEntries(merged, current.filter((entry) => !pruned.has(entry.id)))
}

function isExpired(entry: RineEntry, now: number): boolean {
  if (entry.disposition === 'held') return false
  const age = now - entry.receivedAt
  return age > MAX_AGE_MS || (entry.state === 'read' && age > READ_MAX_AGE_MS)
}

/** Retention: age rules, then the cap. Held entries leave only through the cap, and only after everything else. */
export function pruneEntries(entries: readonly RineEntry[], now: number): PruneResult {
  const kept = entries.filter((entry) => !isExpired(entry, now))
  let excess = kept.length - LEDGER_CAP
  if (excess <= 0) return { entries: kept, droppedHeld: 0 }
  const dropped = new Set<string>()
  let droppedHeld = 0
  for (const wantHeld of [false, true]) {
    for (const entry of kept) {
      if (excess > 0 && (entry.disposition === 'held') === wantHeld) {
        dropped.add(entry.id)
        excess -= 1
        if (wantHeld) droppedHeld += 1
      }
    }
  }
  return { entries: kept.filter((entry) => !dropped.has(entry.id)), droppedHeld }
}

/** Dedup by message id: a known id leaves the ledger as it is. */
export function appendEntry(entries: readonly RineEntry[], entry: RineEntry): { entries: RineEntry[]; isNew: boolean } {
  if (entries.some((other) => other.id === entry.id)) return { entries: [...entries], isNew: false }
  return { entries: [...entries, entry], isNew: true }
}

export function patchEntries(entries: readonly RineEntry[], ids: readonly string[], patch: Partial<RineEntry>): RineEntry[] {
  return entries.map((entry) => (ids.includes(entry.id) ? { ...entry, ...patch } : entry))
}

export function markRead(entries: readonly RineEntry[], ids: readonly string[]): RineEntry[] {
  return patchEntries(entries, ids, { state: 'read' })
}

/** A hand-off also reads the entry. */
export function markHanded(entries: readonly RineEntry[], ids: readonly string[]): RineEntry[] {
  return patchEntries(entries, ids, { disposition: 'handed', state: 'read' })
}

/** The owner applies what non-owners asked for; the applied ids stay only while the file still holds them. */
export function applyRequests(
  entries: readonly RineEntry[],
  requests: readonly RineRequest[],
  applied: readonly string[]
): { entries: RineEntry[]; applied: string[] } {
  const fresh = requests.filter((request) => !applied.includes(request.id))
  let next = [...entries]
  for (const request of fresh) {
    next = request.kind === 'handed' ? markHanded(next, [request.entryId]) : markRead(next, [request.entryId])
  }
  const present = new Set(requests.map((request) => request.id))
  return { entries: next, applied: [...applied, ...fresh.map((request) => request.id)].filter((id) => present.has(id)) }
}

/** The entry id a successful `rine_read` call marks read, or null for any other tool or input. */
export function readToolTarget(tool: string, input: Record<string, unknown>): string | null {
  if (TOOL_PATTERN.exec(tool)?.[1] !== 'rine_read') return null
  const id = input.message_id
  return typeof id === 'string' && id !== '' ? id : null
}

/** A non-owner merges the file and asks for notify rows on what it has not seen since `mirrorSince`. */
export function mirrorLedger(memory: readonly RineEntry[], file: LedgerFile, mirrorSince: number): MirrorResult {
  const known = new Set(memory.map((entry) => entry.id))
  const fresh = file.entries.filter(
    (entry) =>
      !known.has(entry.id) &&
      entry.receivedAt >= mirrorSince &&
      (entry.disposition === 'notified' || entry.disposition === 'woken')
  )
  return { entries: mergeEntries(file.entries, memory), fresh }
}

/** What the startup summary counts. `carried` holds the ids that came off the file at start. */
export function summarizeBacklog(entries: readonly RineEntry[], carried: ReadonlySet<string>): BacklogSummary {
  const isUnread = (entry: RineEntry): boolean => entry.state === 'unread' && entry.list !== 'deny'
  const arrived = entries.filter((entry) => isUnread(entry) && entry.disposition === 'backlog')
  const earlier = entries.filter((e) => isUnread(e) && e.disposition !== 'backlog' && carried.has(e.id))
  const listed = [...arrived, ...earlier].sort((a, b) => b.receivedAt - a.receivedAt)
  return { arrived: arrived.length, earlier: earlier.length, entries: listed }
}
