import type { OrgIdentity } from './org-frames'
import { instantMicros } from './org-mark'
import { detailOf, rowOf, type OrgDetail, type OrgRow, type OrgWindowRow } from './org-rows'

export const ORG_RING_LIMIT = 2000
export const WINDOW_ROWS = 200
/** The most characters the window's rows and detail may measure; rows farthest from the selection drop past it. */
export const WINDOW_BUDGET = 60000

export const TRIMMED_NOTICE = 'Older messages are not kept here. rine tui in a terminal reads the full history.'


export type OrgView = { selectedId: string | null; scrollTop: number; isReaderOpen: boolean }

export const ORG_DIRECTIONS = ['all', 'sent', 'received', 'internal'] as const
export type OrgDirection = (typeof ORG_DIRECTIONS)[number]

/** What the vi keys keep beside the view: the filter, the search, where the keys act, and a key not yet a command. */
export type OrgVi = {
  direction: OrgDirection
  query: string
  focus: 'list' | 'reader'
  readerTop: number
  isHelpOpen: boolean
  /** The findings list stands in for the reader. */
  isFindingsOpen: boolean
  /** `5` of `5j`. */
  count: number | null
  /** The first `g` of `gg`. */
  isG: boolean
  /** The text typed after `/`, null when no search is being typed. */
  typing: string | null
  /** The last key post taken from the surface module: its epoch and its highest sequence number. */
  epoch: string
  seq: number
}

/** A finding outside any one message: the group it was found in, the gap's identity and the sentence the feed said for it. */
export type OrgFinding = { groupId: string; gapKey: string; sentence: string }

/**
 * The org tab store: rows by id, ids newest first, and the findings newest first. Message rows live here only: a plaintext
 * field in `$.state` would reach every plugin.
 */
export type OrgStore = {
  rows: Map<string, OrgRow>
  order: string[]
  findings: OrgFinding[]
  view: OrgView
  vi: OrgVi
  olderCursor: string | null
  /** The org the feed reads, from its hello; null until then, or when the CLI cannot name it. */
  org: OrgIdentity | null
}

export type OrgWindow = {
  rows: OrgWindowRow[]
  /** Position of `rows[0]` in the store's order. */
  first: number
  total: number
  selectedId: string | null
  detail: OrgDetail | null
  notices: string[]
}

export const IDLE_VI: OrgVi = { direction: 'all', query: '', focus: 'list', readerTop: 0, isHelpOpen: false, isFindingsOpen: false, count: null, isG: false, typing: null, epoch: '', seq: 0 }

export function emptyOrgStore(): OrgStore {
  return { rows: new Map(), order: [], findings: [], view: { selectedId: null, scrollTop: 0, isReaderOpen: false }, vi: { ...IDLE_VI }, olderCursor: null, org: null }
}

/** True when a row with this direction shows under the filter. */
export const isInDirection = (filter: OrgDirection, direction: string | null): boolean => filter === 'all' || direction === filter

/** The ids the list shows: every loaded id the direction filter keeps, newest first. */
export function shownIds(store: OrgStore): string[] {
  const { order, rows, vi } = store
  return vi.direction === 'all' ? order : order.filter((id) => isInDirection(vi.direction, rows.get(id)?.message.direction ?? null))
}

const stamp = (row: OrgRow): number => instantMicros(row.message.createdAt)

/** True when `a` sorts before `b` in the newest-first order: the microsecond stamp, then the id. */
function isNewer(a: OrgRow, b: OrgRow): boolean {
  return stamp(a) !== stamp(b) ? stamp(a) > stamp(b) : a.message.id > b.message.id
}

/** Adds or replaces a row by id, keeping the newest `ORG_RING_LIMIT`; older rows drop silently (the window says so). */
export function addOrgRow(store: OrgStore, row: OrgRow): void {
  const { rows, order } = store
  const id = row.message.id
  const known = rows.has(id)
  rows.set(id, row)
  if (!known) {
    let low = 0
    let high = order.length
    while (low < high) {
      const mid = (low + high) >> 1
      const other = rows.get(order[mid] as string) as OrgRow
      if (isNewer(other, row)) low = mid + 1
      else high = mid
    }
    order.splice(low, 0, id)
  }
  for (const dropped of order.splice(ORG_RING_LIMIT)) rows.delete(dropped)
}

const sizeOf = (value: unknown): number => JSON.stringify(value).length + 1

/**
 * The props the pane draws: at most `WINDOW_ROWS` rows around the view, every string scrubbed and clipped, and the
 * measured size under `WINDOW_BUDGET` (rows farthest from the selection drop first). The rows carry message text, as the
 * inbox pane's previews do: a plugin ordered outside this one can read the tree the pane renders, so the one-time
 * acknowledgement tells the reader that other plugins installed in Claude Code can read what the pane shows.
 */
export function windowOf(store: OrgStore): OrgWindow {
  const { rows, view } = store
  const ownSlug = store.org?.slug ?? null
  const order = shownIds(store)
  const selectedAt = view.selectedId === null ? -1 : order.indexOf(view.selectedId)
  const selectedRow = selectedAt < 0 ? undefined : rows.get(order[selectedAt] as string)
  let first = Math.max(0, Math.min(view.scrollTop, order.length - 1))
  if (selectedAt >= 0) first = Math.max(selectedAt - WINDOW_ROWS + 1, Math.min(first, selectedAt))
  const picked = order.slice(first, first + WINDOW_ROWS).map((id): OrgWindowRow => rowOf(rows.get(id) as OrgRow, ownSlug))
  const detail = view.isReaderOpen && selectedRow !== undefined ? detailOf(selectedRow, ownSlug, store.vi.readerTop) : null
  const notices = store.order.length >= ORG_RING_LIMIT ? [TRIMMED_NOTICE] : []
  const selectedId = selectedRow === undefined ? null : view.selectedId
  let used = sizeOf({ first, total: order.length, selectedId, detail, notices }) + picked.reduce((sum, one) => sum + sizeOf(one), 0)
  let start = 0
  let end = picked.length
  while (used > WINDOW_BUDGET && end - start > 1) {
    const isTailFarther = first + end - 1 - selectedAt >= selectedAt - (first + start)
    const dropped = isTailFarther ? picked[end - 1] : picked[start]
    used -= sizeOf(dropped)
    if (isTailFarther) end -= 1
    else start += 1
  }
  const kept = picked.slice(start, end)
  return {
    rows: kept,
    first: first + start,
    total: order.length,
    selectedId,
    detail,
    notices
  }
}
