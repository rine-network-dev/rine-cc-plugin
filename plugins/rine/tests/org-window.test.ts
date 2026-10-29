import { test, expect } from 'claude-code/testing'
import type { OrgFrame } from '../hooks/lib/org-frames'
import { BODY_CHARS, LINE_CELLS, PARTIES_CELLS, detailOf, rowOf } from '../hooks/lib/org-rows'
import {
  ORG_RING_LIMIT,
  WINDOW_BUDGET,
  TRIMMED_NOTICE,
  WINDOW_ROWS,
  addOrgRow,
  emptyOrgStore,
  windowOf,
  type OrgRow
} from '../hooks/lib/org-window'
import { at } from './at'

const ESC = String.fromCharCode(27)

function row(n: number, over: { text?: string; body?: string | null; gap?: string | null; hidden?: number; at?: string; id?: string; fork?: boolean; verdict?: string } = {}): OrgRow {
  const text = over.text ?? `message ${n}`
  const frame: Extract<OrgFrame, { kind: 'row' }> = {
    kind: 'row',
    seq: n,
    message: {
      id: over.id ?? `m-${n}`,
      createdAt: over.at ?? new Date(Date.UTC(2026, 9, 24, 0, 0, 0) + n * 1000).toISOString(),
      type: 'rine.v1.dm',
      direction: 'received',
      from: { agentId: 'a1', handle: 'ann@acme.rine.network', own: true },
      to: { agentId: 'b2', handle: 'bob@acme.rine.network', own: false },
      groupId: null,
      groupHandle: null,
      conversationId: null,
      encryption: 'mls-v1',
      epoch: 1,
      verification: 'verified',
      equivocation: over.fork ?? false,
      gap: null
    },
    display: {
      glyph: over.verdict ?? 'verified',
      verificationLabel: 'verified',
      gapSentence: over.gap ?? null,
      snippet: text,
      body: over.body === undefined ? text : over.body,
      fromShort: 'a1b2c3d4',
      toShort: 'e5f6a7b8',
      fromLabel: null,
      toLabel: null,
      groupLabel: null
    },
    hiddenChars: over.hidden ?? 0,
    textTruncated: 0
  }
  const { kind: _kind, ...rest } = frame
  return rest
}

function filled(count: number, make: (n: number) => OrgRow = row) {
  const store = emptyOrgStore()
  for (let n = 1; n <= count; n++) addOrgRow(store, make(n))
  return store
}

test('test_addOrgRow_outOfOrderArrival_keepsNewestFirst', () => {
  const store = emptyOrgStore()
  for (const n of [2, 5, 1, 4, 3]) addOrgRow(store, row(n))
  expect(store.order).toEqual(['m-5', 'm-4', 'm-3', 'm-2', 'm-1'])
})

test('test_addOrgRow_sameId_replacesInPlace', () => {
  const store = filled(3)
  addOrgRow(store, row(2, { text: 'opened later' }))
  expect(store.order).toEqual(['m-3', 'm-2', 'm-1'])
  expect(store.rows.get('m-2')?.display.snippet).toBe('opened later')
})

test('test_addOrgRow_pastTheRing_dropsTheOldest', () => {
  const store = filled(ORG_RING_LIMIT + 50)
  expect(store.order).toHaveLength(ORG_RING_LIMIT)
  expect(store.rows.size).toBe(ORG_RING_LIMIT)
  expect(at(store.order, 0)).toBe(`m-${ORG_RING_LIMIT + 50}`)
  expect(store.rows.has('m-1')).toBe(false)
  expect(store.rows.has('m-51')).toBe(true)
})

test('test_windowOf_manyRows_capsRowsAndFollowsTheSelection', () => {
  const store = filled(500)
  store.view = { selectedId: 'm-10', scrollTop: 0, isReaderOpen: false }
  const window = windowOf(store)
  expect(window.rows).toHaveLength(WINDOW_ROWS)
  expect(window.total).toBe(500)
  expect(window.rows.map((one) => one.id)).toContain('m-10')
  expect(window.selectedId).toBe('m-10')
  expect(at(window.rows, window.rows.length - 1).id).toBe('m-10')
})

test('test_windowOf_unknownSelection_drawsNoneSelected', () => {
  const store = filled(3)
  store.view = { selectedId: 'gone', scrollTop: 0, isReaderOpen: true }
  const window = windowOf(store)
  expect(window.selectedId).toBeNull()
  expect(window.detail).toBeNull()
})

test('test_windowOf_hostileText_isScrubbedAndClipped', () => {
  const hostile = `${ESC}[31mred${ESC}]0;title\x07 ${'x'.repeat(400)}`
  const store = filled(1, (n) => row(n, { text: hostile, body: hostile + '\n'.repeat(900), hidden: 3 }))
  store.view = { selectedId: 'm-1', scrollTop: 0, isReaderOpen: true }
  const window = windowOf(store)
  const everything = JSON.stringify(window)
  expect(everything).not.toContain(ESC)
  expect(everything).not.toContain('title')
  expect(Array.from(at(window.rows, 0).snippet).length).toBeLessThanOrEqual(LINE_CELLS)
  const detail = window.detail
  if (detail === null) throw new Error('no detail')
  expect(detail.lines.join('\n').length).toBeLessThanOrEqual(BODY_CHARS)
  expect(detail.notes.join(' ')).toContain('hidden')
})

test('test_windowOf_gapRow_showsTheSentenceInTheReader', () => {
  const store = filled(1, (n) => row(n, { body: null, gap: 'Keys were not available.' }))
  store.view = { selectedId: 'm-1', scrollTop: 0, isReaderOpen: true }
  const detail = windowOf(store).detail
  expect(detail?.lines).toEqual(['Keys were not available.'])
  expect(at(windowOf(store).rows, 0).snippet).toBe('Keys were not available.')
  expect(at(windowOf(store).rows, 0).snippetTone).toBe('warning')
})

test('test_windowOf_fullRing_saysOlderMessagesAreNotKept', () => {
  expect(windowOf(filled(3)).notices).toEqual([])
  expect(windowOf(filled(ORG_RING_LIMIT)).notices).toEqual([TRIMMED_NOTICE])
})

test('test_windowOf_twoThousandRowsOfMaximumWidthHostileText_staysInBudget', () => {
  const wide = '\u{1D49C}'.repeat(LINE_CELLS) + '́'.repeat(2000) + '"\\'.repeat(500) + '漢'.repeat(500)
  const store = filled(ORG_RING_LIMIT, (n) => row(n, { text: wide, body: wide.repeat(20) }))
  store.view = { selectedId: 'm-1000', scrollTop: 900, isReaderOpen: true }
  const window = windowOf(store)
  expect(JSON.stringify(window).length).toBeLessThan(WINDOW_BUDGET)
  expect(window.rows.length).toBeLessThanOrEqual(WINDOW_ROWS)
  expect(window.rows.map((one) => one.id)).toContain('m-1000')
  expect(window.detail).not.toBeNull()
})

test('test_windowOf_widestPossibleRows_dropRowsFarthestFromTheSelection', () => {
  const wide = '"'.repeat(LINE_CELLS)
  const store = filled(300, (n) => {
    const base = row(n, { text: wide })
    return { ...base, message: { ...base.message, from: { ...base.message.from, handle: wide } } }
  })
  store.view = { selectedId: 'm-150', scrollTop: 100, isReaderOpen: false }
  const window = windowOf(store)
  expect(JSON.stringify(window).length).toBeLessThan(WINDOW_BUDGET)
  expect(window.rows.length).toBeLessThan(WINDOW_ROWS)
  expect(window.rows.map((one) => one.id)).toContain('m-150')
  expect(window.first).toBe(store.order.indexOf(at(window.rows, 0).id))
})

test('test_windowOf_verdictName_drawsItsCharacterNotTheWord', () => {
  const store = filled(5, (n) => row(n, { verdict: ['verified', 'invalid', 'senderMismatch', 'unverifiable', 'gap'][n - 1] }))
  const rows = store.order.map((id) => windowOf(store).rows.find((one) => one.id === id))
  for (const one of rows) expect(JSON.stringify(one)).not.toMatch(/invalid|senderMismatch|unverifiable|gap/)
  expect(rows.map((one) => one?.mark)).toEqual(['!', '?', '✗', '✗', '✓'])
  expect(rows.map((one) => one?.tone)).toEqual(['warning', 'warning', 'error', 'error', 'success'])
})

test('test_rowOf_partiesPastTheirCells_clipEachSideSoNeitherPartyVanishes', () => {
  const base = row(1)
  const group = { ...base, message: { ...base.message, to: null, groupId: 'g-1', groupHandle: '#mx-orgread-closed-874177@mx-ts-sdk-874177.rine.network', from: { ...base.message.from, handle: 'mx-cli@mx-cli-874177.rine.network' } } }
  expect(rowOf(group, 'acme').parties).toBe('#mx-orgrea…@mx-ts-… · mx-cli@…')
  const pair = { ...base, message: { ...base.message, to: { ...base.message.to, handle: 'a-very-long-recipient-name@fjord21735.rine.network' } } } as OrgRow
  expect(rowOf(pair, 'acme').parties).toBe('ann → a-very-long-…@fjord21735')
  expect(Array.from(rowOf(group, 'acme').parties).length).toBeLessThanOrEqual(PARTIES_CELLS)
})

test('test_rowOf_labelPastTheScrubCap_keepsItsDomainWhenTheColumnClipsTheLocalPart', () => {
  const base = row(1)
  const toLabel = `${'r'.repeat(60)}@fjord21735`
  const long = { ...base, display: { ...base.display, toLabel } } as OrgRow
  expect(rowOf(long, 'acme').parties).toMatch(/…@fjord21735$/)
})

test('test_detailOf_remoteNames_carryTheirWholeDomainForTheReaderToFit', () => {
  const base = row(1)
  const local = 's'.repeat(60)
  const raw = { ...base, message: { ...base.message, from: { ...base.message.from, handle: `${local}@fjord21735.rine.network` } } } as OrgRow
  const labelled = { ...base, display: { ...base.display, fromLabel: `${local}@fjord21735` } } as OrgRow
  for (const one of [raw, labelled]) {
    const name = detailOf(one, 'acme', 0).from.name
    expect(name).toBe(`${local}@fjord21735`)
  }
})

test('test_windowOf_forkedHistory_marksTheRowAndSaysSoInTheReader', () => {
  const store = filled(2, (n) => row(n, { fork: n === 2 }))
  store.view = { selectedId: 'm-2', scrollTop: 0, isReaderOpen: true }
  const window = windowOf(store)
  expect(at(window.rows, 0)).toMatchObject({ mark: '✓', equivocal: true })
  expect(at(window.rows, 1)).toMatchObject({ mark: '✓', equivocal: false })
  expect(window.detail?.notes).toContain('two different copies of this message were seen')
  expect(window.detail).toMatchObject({ mark: '✓', equivocal: true })
})

test('test_addOrgRow_sameMillisecondDifferentMicroseconds_ordersByMicroseconds', () => {
  const store = emptyOrgStore()
  addOrgRow(store, row(1, { id: 'a', at: '2026-10-24T00:00:00.000900+00:00' }))
  addOrgRow(store, row(2, { id: 'b', at: '2026-10-24T00:00:00.000100+00:00' }))
  addOrgRow(store, row(3, { id: 'c', at: '2026-10-24T00:00:00.000500+00:00' }))
  expect(store.order).toEqual(['a', 'c', 'b'])
})

test('test_addOrgRow_sameInstant_ordersByIdNotArrival', () => {
  const store = emptyOrgStore()
  const at0 = '2026-10-24T00:00:00.000100+00:00'
  addOrgRow(store, row(9, { id: 'b', at: at0 }))
  addOrgRow(store, row(1, { id: 'c', at: at0 }))
  addOrgRow(store, row(5, { id: 'a', at: at0 }))
  expect(store.order).toEqual(['c', 'b', 'a'])
})
