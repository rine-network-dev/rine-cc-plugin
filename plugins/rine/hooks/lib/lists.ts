import type { RineList, RineListEntry, RineLists } from '../../types/index'
import { digestHex, readSealed, updateSealed, type Sealed, type Updated } from './envelope'
import { isRecord } from './narrow'
import type { Ports } from './ports'
import { statePath } from './refs'

export const MAX_ENTRIES = 200
export const EMPTY_LISTS: RineLists = { allow: [], deny: [] }

const HANDLE = /^#?[a-z0-9._-]+@[a-z0-9.-]+$/

export type ListName = 'allow' | 'deny'

/**
 * The digest of the file as the human last wrote or confirmed it, kept alone so a rollback reads as untrusted.
 * Backed by `$.store`.
 */
export type TrustPort = {
  load: () => Promise<readonly string[]>
  save: (digests: readonly string[]) => Promise<void>
}

type FileIo = Pick<Ports, 'fs' | 'clock'>
export type ListsView = { lists: RineLists; digest: string | null; isTrusted: boolean }
export const EMPTY_VIEW: ListsView = { lists: EMPTY_LISTS, digest: null, isTrusted: true }

/** Who a message is from. `handle` is null when the frame carried no `sender_handle`. */
export type Sender = { handle: string | null; agentId: string; groupHandle: string | null; groupId: string | null }
export type ListMatch = { list: RineList; reboundHandle: string | null }

export function parseHandle(raw: string): RineListEntry | null {
  const handle = raw.trim().toLowerCase()
  if (!HANDLE.test(handle)) return null
  return { kind: handle.startsWith('#') ? 'group' : 'agent', handle, agentId: null }
}

function normalizeEntry(value: unknown): RineListEntry | null {
  if (!isRecord(value) || typeof value.handle !== 'string') return null
  const entry = parseHandle(value.handle)
  if (entry === null || entry.kind !== value.kind) return null
  const id = value.agentId
  return { ...entry, agentId: typeof id === 'string' && id !== '' ? id : null }
}

function normalizeList(value: unknown): RineListEntry[] {
  if (!Array.isArray(value)) return []
  const entries: RineListEntry[] = []
  for (const item of value.slice(0, MAX_ENTRIES)) {
    const entry = normalizeEntry(item)
    if (entry !== null) entries.push(entry)
  }
  return entries
}

export function normalizeLists(value: unknown): RineLists | null {
  if (!isRecord(value)) return null
  return { allow: normalizeList(value.allow), deny: normalizeList(value.deny) }
}

function targetOf(entry: RineListEntry, sender: Sender): { handle: string | null; id: string | null } {
  if (entry.kind === 'group') return { handle: sender.groupHandle?.toLowerCase() ?? null, id: sender.groupId }
  return { handle: sender.handle?.toLowerCase() ?? null, id: sender.agentId }
}

function isDenied(entry: RineListEntry, sender: Sender): boolean {
  const target = targetOf(entry, sender)
  return target.handle === entry.handle || (entry.agentId !== null && target.id === entry.agentId)
}

function allowFit(entry: RineListEntry, sender: Sender): 'match' | 'rebound' | 'no' {
  const target = targetOf(entry, sender)
  if (target.handle !== entry.handle) return 'no'
  return entry.agentId === null || entry.agentId === target.id ? 'match' : 'rebound'
}

/** Deny matches on handle or id; allow needs the handle and, once pinned, the same id. */
export function matchLists(lists: RineLists, sender: Sender): ListMatch {
  if (lists.deny.some((entry) => isDenied(entry, sender))) return { list: 'deny', reboundHandle: null }
  let reboundHandle: string | null = null
  for (const entry of lists.allow) {
    const fit = allowFit(entry, sender)
    if (fit === 'match') return { list: 'allow', reboundHandle: null }
    if (fit === 'rebound') reboundHandle = entry.handle
  }
  return { list: 'none', reboundHandle }
}

/** Lists with every unpinned entry that names this sender or group pinned to its id, or undefined when nothing changed. */
export function pinIds(lists: RineLists, sender: Sender): RineLists | undefined {
  let isChanged = false
  const pin = (entries: RineListEntry[]): RineListEntry[] =>
    entries.map((entry) => {
      const target = targetOf(entry, sender)
      if (entry.agentId !== null || target.handle !== entry.handle || target.id === null) return entry
      isChanged = true
      return { ...entry, agentId: target.id }
    })
  const next = { allow: pin(lists.allow), deny: pin(lists.deny) }
  return isChanged ? next : undefined
}

function sameEntry(a: RineListEntry, b: RineListEntry): boolean {
  return a.kind === b.kind && a.handle === b.handle
}

function without(entries: RineListEntry[], entry: RineListEntry): RineListEntry[] {
  return entries.filter((other) => !sameEntry(other, entry))
}

function withList(lists: RineLists, name: ListName, entries: RineListEntry[]): RineLists {
  return name === 'allow' ? { allow: entries, deny: lists.deny } : { allow: lists.allow, deny: entries }
}

/** Adds the entry to one list and drops it from the other; undefined when that list is full. */
export function addEntry(lists: RineLists, name: ListName, entry: RineListEntry): RineLists | undefined {
  const own = lists[name]
  const existing = own.find((other) => sameEntry(other, entry))
  if (existing === undefined && own.length >= MAX_ENTRIES) return undefined
  const merged: RineListEntry = { ...entry, agentId: entry.agentId ?? existing?.agentId ?? null }
  const other: ListName = name === 'allow' ? 'deny' : 'allow'
  return withList(withList(lists, name, [...without(own, entry), merged]), other, without(lists[other], entry))
}

export function removeEntry(lists: RineLists, name: ListName, entry: RineListEntry): RineLists {
  return withList(lists, name, without(lists[name], entry))
}

/** What an absent file reads as: empty and trusted until a write was recorded, untrusted after. */
function absentView(known: readonly string[]): ListsView {
  return known.length === 0 ? EMPTY_VIEW : { lists: EMPTY_LISTS, digest: null, isTrusted: false }
}

/** An unknown file keeps the last good view; with none, it reads as an absent one. */
export async function readLists(
  ports: FileIo, trust: TrustPort, rineDir: string, previous: ListsView = EMPTY_VIEW
): Promise<ListsView> {
  const known = await trust.load()
  const sealed = await readSealed(ports, statePath(rineDir, 'lists'))
  if (sealed.status === 'absent') return absentView(known)
  const lists = sealed.status === 'ok' ? normalizeLists(sealed.value) : null
  if (sealed.status !== 'ok' || lists === null) return previous.digest === null ? absentView(known) : previous
  const digest = await digestHex(sealed.body)
  const isTrusted = known.includes(digest)
  if (isTrusted && known.length > 1 && known[known.length - 1] === digest) await trust.save([digest])
  return { lists, digest, isTrusted }
}

/** The lists an edit starts from, and whether they are the ones the human last wrote or confirmed. */
async function baseOf(current: Sealed, trust: TrustPort, previous: ListsView): Promise<ListsView> {
  const stored = current.status === 'ok' ? normalizeLists(current.value) : null
  if (current.status === 'ok' && stored !== null) {
    const digest = await digestHex(current.body)
    return { lists: stored, digest, isTrusted: (await trust.load()).includes(digest) }
  }
  return current.status === 'absent' ? absentView(await trust.load()) : previous
}

/**
 * A human edit of the file: `edit` answers the next lists, or undefined for no change, and is told whether
 * its start is trusted. Only an edit of trusted lists records its digest: before the write, beside the old one, so no
 * reader sees the new file as untrusted; alone once the write read back. However the read-back went, the record ends
 * as one digest: the edit's when it stored, the one it started from when it did not. An edit of untrusted lists is
 * written but stays untrusted, because only Confirm re-trusts what an outside writer put there.
 */
export async function updateLists(
  ports: FileIo, trust: TrustPort, rineDir: string,
  edit: (lists: RineLists, isTrusted: boolean) => RineLists | undefined, previous: ListsView = EMPTY_VIEW
): Promise<Updated<RineLists>> {
  const seen: { saved: { base: string | null; next: string } | null } = { saved: null }
  const out = await updateSealed<RineLists>(ports, statePath(rineDir, 'lists'), async (current) => {
    const base = await baseOf(current, trust, previous)
    const next = edit(base.lists, base.isTrusted)
    if (next !== undefined && base.isTrusted) {
      seen.saved = { base: base.digest, next: await digestHex(JSON.stringify(next)) }
      await trust.save([...(base.digest === null ? [] : [base.digest]), seen.saved.next])
    }
    return next
  })
  const { saved } = seen
  if (saved !== null) {
    const kept = out.status === 'ok' ? saved.next : saved.base
    await trust.save(kept === null ? [] : [kept])
  }
  return out
}

/** The pane's Confirm: trusts the file as it stands (an absent one as empty). Null when the file is unreadable. */
export async function confirmLists(ports: FileIo, trust: TrustPort, rineDir: string): Promise<ListsView | null> {
  const sealed = await readSealed(ports, statePath(rineDir, 'lists'))
  if (sealed.status === 'absent') {
    await trust.save([])
    return EMPTY_VIEW
  }
  const lists = sealed.status === 'ok' ? normalizeLists(sealed.value) : null
  if (sealed.status !== 'ok' || lists === null) return null
  const digest = await digestHex(sealed.body)
  await trust.save([digest])
  return { lists, digest, isTrusted: true }
}
