import { MAX_LINE_CHARS, createLineBuffer, type LineBuffer } from './frames'
import { isRecord } from './narrow'
import { type Obj, gap, nullableId, nullableNum, num, safeId } from './org-fields'
import { type OrgRow, parseRow } from './org-row'

export type { OrgGap } from './org-fields'
export type { OrgDisplay, OrgMessage, OrgParty, OrgRow } from './org-row'
export { MAX_LINE_CHARS }

/** The feed protocol version this plugin speaks. Any other `v` is refused. */
export const FEED_VERSION = 1

export type OrgInvalidReason = 'json' | 'shape' | 'version' | 'oversized'

/** The org the feed reads, from the CLI's `GET /whoami`; null when the CLI could not name it (or is older). */
export type OrgIdentity = { name: string; slug: string }

export type OrgPageKind = 'initial' | 'poll' | 'older'

export type OrgFrame =
  | { kind: 'hello'; orgId: string; pollSeconds: number; org: OrgIdentity | null }
  | OrgRow
  | { kind: 'finding'; groupId: string; gapKey: string; sentence: string }
  | { kind: 'page'; pageKind: OrgPageKind; count: number; olderCursor: string | null }
  | { kind: 'heartbeat'; nextPollSeconds: number; pausedSeconds: number | null }
  | { kind: 'error'; code: string; sentence: string; retrySeconds: number | null }
  | { kind: 'ignored'; event: string }
  | { kind: 'invalid'; reason: OrgInvalidReason }

const PAGE_KINDS: readonly string[] = ['initial', 'poll', 'older']
const OVERSIZED: OrgFrame = { kind: 'invalid', reason: 'oversized' }
const INVALID_SHAPE: OrgFrame = { kind: 'invalid', reason: 'shape' }

/** A gap's identity for telling it once: its reason and each field it defines in a fixed order, the way the readers key it. */
function gapKeyOf(gap: Obj, reason: string): string {
  const field = (name: string) => {
    const value = gap[name]
    return typeof value === 'string' || typeof value === 'number' ? value : null
  }
  return JSON.stringify([reason, field('epoch'), field('uploader'), field('sender'), field('index')])
}

function finding(data: Obj): OrgFrame {
  const parsedGap = gap(data.gap)
  const groupId = safeId(data.group_id)
  const { sentence } = data
  if (groupId === undefined || typeof sentence !== 'string') return INVALID_SHAPE
  if (parsedGap === undefined || parsedGap === null) return INVALID_SHAPE
  return { kind: 'finding', groupId, gapKey: gapKeyOf(data.gap as Obj, parsedGap.reason), sentence }
}

function page(data: Obj): OrgFrame {
  const count = num(data.count)
  const olderCursor = nullableId(data.older_cursor)
  const { kind } = data
  if (count === undefined || olderCursor === undefined) return INVALID_SHAPE
  if (typeof kind !== 'string' || !PAGE_KINDS.includes(kind)) return INVALID_SHAPE
  return { kind: 'page', pageKind: kind as OrgPageKind, count, olderCursor }
}

function heartbeat(data: Obj): OrgFrame {
  const nextPollSeconds = num(data.next_poll_s)
  const pausedSeconds = nullableNum(data.paused_s)
  if (nextPollSeconds === undefined || pausedSeconds === undefined) return INVALID_SHAPE
  return { kind: 'heartbeat', nextPollSeconds, pausedSeconds }
}

function error(data: Obj): OrgFrame {
  const { code, sentence } = data
  const retrySeconds = nullableNum(data.retry_s)
  if (typeof code !== 'string' || typeof sentence !== 'string' || retrySeconds === undefined) return INVALID_SHAPE
  return { kind: 'error', code, sentence, retrySeconds }
}

/** Absent or null reads as no org; a present value that is not `{name, slug}` strings is malformed. */
function orgIdentity(value: unknown): OrgIdentity | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.slug !== 'string') return undefined
  return { name: value.name, slug: value.slug }
}

function row(data: Obj): OrgFrame {
  return parseRow(data) ?? INVALID_SHAPE
}

function hello(data: Obj): OrgFrame {
  const orgId = safeId(data.org_id)
  const pollSeconds = num(data.poll_s)
  const org = orgIdentity(data.org)
  if (data.principal !== 'org' || orgId === undefined || pollSeconds === undefined || org === undefined) return INVALID_SHAPE
  return { kind: 'hello', orgId, pollSeconds, org }
}

const READERS: Record<string, (data: Obj) => OrgFrame> = { hello, row, finding, page, heartbeat, error }

/** Parses one feed line. A refusal carries its reason only, never any part of the line, so plaintext cannot leak through an error. */
export function parseOrgFrame(line: string): OrgFrame {
  let envelope: unknown
  try {
    envelope = JSON.parse(line)
  } catch {
    return { kind: 'invalid', reason: 'json' }
  }
  if (!isRecord(envelope) || typeof envelope.event !== 'string' || !isRecord(envelope.data)) {
    return INVALID_SHAPE
  }
  if (envelope.data.v !== FEED_VERSION) return { kind: 'invalid', reason: 'version' }
  const read = Object.hasOwn(READERS, envelope.event) ? READERS[envelope.event] : undefined
  return read === undefined ? { kind: 'ignored', event: envelope.event } : read(envelope.data)
}

export function createOrgLineBuffer(): LineBuffer<OrgFrame> {
  return createLineBuffer(parseOrgFrame, OVERSIZED)
}
