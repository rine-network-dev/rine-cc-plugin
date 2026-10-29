import { isInDirection, ORG_DIRECTIONS, windowOf, ORG_RING_LIMIT, type OrgDirection, type OrgStore, type OrgView, type OrgVi } from './org-window'

/** A key as the surface module hands it on: a name (`return`, `pagedown`, `up`) or the character typed. */
export type KeyEvent = { key: string; ctrl?: boolean; meta?: boolean }

/** What a key asks of the rest of the tab: nothing, the inbox, a fresh read, or an older page. */
export type KeyEffect = 'none' | 'inbox' | 'reread' | 'older'

/** A loaded row as the keys see it. */
export type KeyRow = { id: string; direction: string | null; text: string; isMarked: boolean }

export type KeyModel = { view: OrgView; vi: OrgVi }

export type KeyResult = KeyModel & { effect: KeyEffect }

/** Rows a page moves, and half a page half of it: the pane has no fixed screen, so this is a count, not a measure. */
export const PAGE_ROWS = 20
const MAX_COUNT = 9999
const MAX_QUERY = 120

/** The keys of the tab, as the help overlay words them. */
export const ORG_KEYS_HELP: readonly string[] = [
  'j k  next / previous row (a line in the reader); a count goes first: 5j',
  `gg G  first / last loaded row; G at the last row loads older messages (the newest ${ORG_RING_LIMIT} are kept)`,
  'ctrl-u PgUp  half page up      PgDn  half page down      ctrl-b  page up      ctrl-f  page down',
  'h l  move between the list and the reader      Enter  open the reader',
  '/  search the loaded rows (Enter runs it, Enter on nothing cancels)      n N  next / previous match',
  '] [  next / previous gap or unverified row      D  cycle direction: all, sent, received, internal',
  'f  list the findings, when there are any      R  read again from the newest page      i  back to the inbox',
  'q  close the reader, the findings or this help      ?  this help'
]

/** Plain keys that move by rows (the half page is PgDn because ctrl-d never reaches the pane), and the control keys that do. */
type Move = { sign: 1 | -1; rows: number }
const HALF = PAGE_ROWS >> 1
const MOVES = new Map<string, Move>([
  ['j', { sign: 1, rows: 1 }], ['down', { sign: 1, rows: 1 }], ['k', { sign: -1, rows: 1 }], ['up', { sign: -1, rows: 1 }],
  ['pagedown', { sign: 1, rows: HALF }], ['pageup', { sign: -1, rows: HALF }]
])
const CTRL_MOVES = new Map<string, Move>([['u', { sign: -1, rows: HALF }], ['f', { sign: 1, rows: PAGE_ROWS }], ['b', { sign: -1, rows: PAGE_ROWS }]])

/** The rows the keys move over: every loaded row, with the text a search looks in. */
export function keyRowsOf(store: OrgStore): KeyRow[] {
  return store.order.flatMap((id) => {
    const row = store.rows.get(id)
    if (row === undefined) return []
    const { message, display } = row
    const to = message.to === null ? (message.groupHandle ?? '') : (message.to.handle ?? '')
    const text = `${message.from.handle ?? ''} ${to} ${display.snippet}`.toLowerCase()
    return [{ id, direction: message.direction, text, isMarked: message.gap !== null || message.verification !== 'verified' }]
  })
}

const isPrintable = (key: string): boolean => Array.from(key).length === 1 && !/\p{C}/u.test(key)

/** The `/` prompt: characters add, backspace removes, Enter runs the search, and Enter on nothing cancels it. */
function typeKey({ view, vi }: KeyModel, shown: readonly KeyRow[], k: KeyEvent): KeyResult {
  const typing = vi.typing ?? ''
  const typed = (next: Partial<OrgVi>, selectedId = view.selectedId): KeyResult => ({ view: { ...view, selectedId }, vi: { ...vi, ...next }, effect: 'none' })
  if (k.key === 'return') {
    if (typing === '') return typed({ typing: null })
    const at = shown.findIndex((row) => row.id === view.selectedId)
    const first = [...shown.slice(at + 1), ...shown.slice(0, at + 1)].find((row) => row.text.includes(typing.toLowerCase()))
    return typed({ typing: null, query: typing, readerTop: 0 }, first?.id ?? view.selectedId)
  }
  if (k.key === 'backspace') return typed({ typing: Array.from(typing).slice(0, -1).join('') })
  const char = k.key === 'space' ? ' ' : k.key
  const isText = k.ctrl !== true && k.meta !== true && (char === ' ' || isPrintable(char)) && typing.length < MAX_QUERY
  return typed(isText ? { typing: typing + char } : {})
}

/** Indexes of the rows holding the query, none for an empty one. */
const matchesOf = (shown: readonly KeyRow[], query: string): number[] =>
  query === '' ? [] : shown.flatMap((row, index) => (row.text.includes(query.toLowerCase()) ? [index] : []))

/** The next direction in the cycle, and the row that stays selected: the current one if it still shows, else the first. */
function nextDirection({ view, vi }: KeyModel, rows: readonly KeyRow[]): { direction: OrgDirection; selectedId: string | null } {
  const direction = ORG_DIRECTIONS[(ORG_DIRECTIONS.indexOf(vi.direction) + 1) % ORG_DIRECTIONS.length] ?? 'all'
  const kept = rows.filter((row) => isInDirection(direction, row.direction))
  return { direction, selectedId: kept.some((row) => row.id === view.selectedId) ? view.selectedId : (kept[0]?.id ?? null) }
}

/** What a handler knows of the key in progress: the model, the rows, the rows the direction shows, where the selection is. */
type Step = { model: KeyModel; rows: readonly KeyRow[]; shown: readonly KeyRow[]; at: number; last: number; isReader: boolean }

/** Any other key drops a pending count and the first `g`. */
function settle({ model: { view, vi } }: Step, next: Partial<OrgVi> = {}, patch: Partial<OrgView> = {}, effect: KeyEffect = 'none'): KeyResult {
  return { view: { ...view, ...patch }, vi: { ...vi, count: null, isG: false, ...next }, effect }
}

/** A key that is not a command yet: it changes the pending state and keeps the count. */
const pend = ({ model: { view, vi } }: Step, next: Partial<OrgVi>): KeyResult => ({ view, vi: { ...vi, ...next }, effect: 'none' })

function pick(step: Step, to: number): KeyResult {
  const { model: { view, vi }, shown, last } = step
  const id = shown[Math.min(Math.max(to, 0), last)]?.id ?? null
  return settle(step, { readerTop: id === view.selectedId ? vi.readerTop : 0 }, { selectedId: id })
}

/** A digit builds the count of the next motion; a `0` with no count before it is not one. */
function countKey(step: Step, k: KeyEvent): KeyResult | null {
  const { count } = step.model.vi
  const isDigit = k.ctrl !== true && k.meta !== true && /^[0-9]$/.test(k.key)
  return isDigit && (k.key !== '0' || count !== null) ? pend(step, { isG: false, count: Math.min((count ?? 0) * 10 + Number(k.key), MAX_COUNT) }) : null
}

/** A row or half-page motion, repeated by the count: in the list it moves the selection, in the reader its top line. */
function moveKey(step: Step, k: KeyEvent): KeyResult | null {
  const move = (k.ctrl === true ? CTRL_MOVES : MOVES).get(k.key)
  if (move === undefined) return null
  const { vi } = step.model
  const by = move.sign * move.rows * (vi.count ?? 1)
  return step.isReader ? settle(step, { readerTop: Math.max(vi.readerTop + by, 0) }) : pick(step, step.at + by)
}

/** `/` opens the prompt; `n` and `N` go to the next and previous row holding the query, wrapping at the ends. */
function searchKey(step: Step, k: KeyEvent): KeyResult | null {
  if (k.key === '/') return settle(step, { typing: '' })
  if (k.key !== 'n' && k.key !== 'N') return null
  const { shown, at } = step
  const hits = matchesOf(shown, step.model.vi.query)
  const index = k.key === 'n' ? (hits.find((one) => one > at) ?? hits[0]) : ([...hits].reverse().find((one) => one < at) ?? hits[hits.length - 1])
  return index === undefined ? settle(step) : pick(step, index)
}

/** `]` and `[` go to the next and previous gap or unverified row. */
function markerKey(step: Step, k: KeyEvent): KeyResult | null {
  if (k.key !== ']' && k.key !== '[') return null
  const sign = k.key === ']' ? 1 : -1
  const { shown, at, last } = step
  for (let index = Math.max(at, 0) + sign; index >= 0 && index <= last; index += sign) if (shown[index]?.isMarked === true) return pick(step, index)
  return settle(step)
}

/** The rest: `gg` `G`, the focus, the reader, the inbox, a fresh read, the help, the findings and the direction. */
function plainKey(step: Step, k: KeyEvent): KeyResult {
  const { model, rows, shown, at, last, isReader } = step
  const { view, vi } = model
  switch (k.key) {
    case 'g': return vi.isG ? (isReader ? settle(step, { readerTop: 0 }) : pick(step, 0)) : pend(step, { count: null, isG: true })
    case 'G': return isReader ? settle(step, { readerTop: Number.MAX_SAFE_INTEGER }) : at === last && last >= 0 && rows.length < ORG_RING_LIMIT ? settle(step, {}, {}, 'older') : pick(step, last)
    case 'h': case 'left': return settle(step, { focus: 'list' })
    case 'l': case 'right': return settle(step, view.isReaderOpen ? { focus: 'reader' } : {})
    case 'return': return last < 0 ? settle(step) : settle(step, { focus: 'reader', readerTop: view.isReaderOpen ? vi.readerTop : 0 }, { isReaderOpen: true, selectedId: at < 0 ? (shown[0]?.id ?? null) : view.selectedId })
    case 'q': return view.isReaderOpen ? settle(step, { focus: 'list', readerTop: 0 }, { isReaderOpen: false }) : settle(step)
    case 'i': return settle(step, {}, {}, 'inbox')
    case 'R': return settle(step, {}, {}, 'reread')
    case '?': return settle(step, { isHelpOpen: true })
    case 'f': return settle(step, { isFindingsOpen: true })
    case 'D': {
      const { direction, selectedId } = nextDirection(model, rows)
      return settle(step, { direction, readerTop: 0 }, { selectedId, scrollTop: 0 })
    }
    default: return settle(step)
  }
}

/**
 * One key of the tab's vi keys as a pure step: counts (`5j`), `gg`, `G`, half page, page, `/` search with `n` `N`, `]` `[`,
 * `D`, `f`, `R`, `h` `l`, `Enter`, `q`, `i` and `?`. Escape, ctrl-d and ctrl-x never reach a surface module, so none is bound.
 */
export function reduceOrgKey(model: KeyModel, rows: readonly KeyRow[], k: KeyEvent): KeyResult {
  const shown = rows.filter((row) => isInDirection(model.vi.direction, row.direction))
  if (model.vi.typing !== null) return typeKey(model, shown, k)
  const step: Step = { model, rows, shown, at: shown.findIndex((row) => row.id === model.view.selectedId), last: shown.length - 1, isReader: model.vi.focus === 'reader' }
  if (model.vi.isHelpOpen) return settle(step, k.key === '?' || k.key === 'q' ? { isHelpOpen: false } : {})
  if (model.vi.isFindingsOpen) return settle(step, k.key === 'f' || k.key === 'q' ? { isFindingsOpen: false } : {})
  const early = countKey(step, k) ?? (k.meta === true ? settle(step) : moveKey(step, k))
  if (early !== null) return early
  return k.ctrl === true ? settle(step) : (searchKey(step, k) ?? markerKey(step, k) ?? plainKey(step, k))
}

/** Runs keys over a store in place, then keeps the drawn window and the reader on the selection; the effects the keys asked for, in order. */
export function stepOrgKeys(store: OrgStore, events: readonly KeyEvent[]): KeyEffect[] {
  const rows = keyRowsOf(store)
  const effects = events.map((event) => {
    const next = reduceOrgKey(store, rows, event)
    Object.assign(store.view, next.view)
    Object.assign(store.vi, next.vi)
    return next.effect
  })
  if (store.findings.length === 0) store.vi.isFindingsOpen = false
  const win = windowOf(store)
  store.view.scrollTop = win.first
  store.vi.readerTop = win.detail?.top ?? 0
  return effects
}
