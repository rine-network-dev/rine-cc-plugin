import { test, expect } from 'claude-code/testing'
import {
  adoptMerged,
  appendEntry,
  applyRequests,
  counts,
  LEDGER_CAP,
  markHanded,
  markRead,
  mergeEntries,
  mirrorLedger,
  normalizeLedger,
  pruneEntries,
  readToolTarget,
  summarizeBacklog,
  type LedgerFile
} from '../hooks/lib/ledger'
import { at } from './at'
import { makeEntry } from './entry-kit'

const NOW = 10_000_000_000
const HOUR = 3600000
const DAY = 24 * HOUR

test('test_counts_mixedEntries_splitsUnreadHeldAndFiltered', () => {
  const entries = [
    makeEntry({ id: 'a' }),
    makeEntry({ id: 'b', state: 'read' }),
    makeEntry({ id: 'c', disposition: 'held' }),
    makeEntry({ id: 'd', list: 'deny', disposition: 'silent' }),
    makeEntry({ id: 'e', list: 'allow', disposition: 'woken' })
  ]
  expect(counts(entries)).toEqual({ unread: 2, held: 1, filtered: 1 })
})

test('test_adoptMerged_changeMadeDuringTheWrite_survivesAndPrunedEntryStaysGone', () => {
  const old = makeEntry({ id: 'old', receivedAt: 1 })
  const a = makeEntry({ id: 'a', receivedAt: 2 })
  const late = makeEntry({ id: 'late', receivedAt: 3 })
  const readA = { ...a, state: 'read' as const }
  const adopted = adoptMerged([old, readA, late], [old, a], [a])
  expect(adopted.map((entry) => [entry.id, entry.state])).toEqual([
    ['a', 'read'],
    ['late', 'unread']
  ])
})

test('test_mergeEntries_sameIdReadWins_andRowIndexIsKept', () => {
  const file = [makeEntry({ id: 'a', state: 'read' })]
  const memory = [makeEntry({ id: 'a', rowIndex: 7 })]
  expect(mergeEntries(file, memory)).toEqual([makeEntry({ id: 'a', state: 'read', rowIndex: 7 })])
})

test('test_mergeEntries_dispositionRank_handedBeatsWokenBeatsNotified', () => {
  const merged = (a: 'notified' | 'woken' | 'handed', b: 'notified' | 'woken' | 'handed') =>
    at(mergeEntries([makeEntry({ disposition: a })], [makeEntry({ disposition: b })]), 0).disposition
  expect(merged('woken', 'notified')).toBe('woken')
  expect(merged('notified', 'woken')).toBe('woken')
  expect(merged('handed', 'woken')).toBe('handed')
  expect(merged('woken', 'handed')).toBe('handed')
})

test('test_mergeEntries_unionOfIds_isOldestFirst', () => {
  const merged = mergeEntries([makeEntry({ id: 'b', receivedAt: 20 })], [makeEntry({ id: 'a', receivedAt: 10 })])
  expect(merged.map((entry) => entry.id)).toEqual(['a', 'b'])
})

test('test_pruneEntries_readOlderThanADay_isDropped', () => {
  const old = makeEntry({ id: 'old', state: 'read', receivedAt: NOW - DAY - 1 })
  const keep = makeEntry({ id: 'keep', state: 'read', receivedAt: NOW - DAY + HOUR })
  expect(pruneEntries([old, keep], NOW).entries).toEqual([keep])
})

test('test_pruneEntries_unreadOlderThanAWeek_isDropped_butHeldStays', () => {
  const old = makeEntry({ id: 'old', receivedAt: NOW - 7 * DAY - 1 })
  const held = makeEntry({ id: 'held', disposition: 'held', receivedAt: NOW - 30 * DAY })
  const result = pruneEntries([old, held], NOW)
  expect(result.entries.map((entry) => entry.id)).toEqual(['held'])
  expect(result.droppedHeld).toBe(0)
})

test('test_pruneEntries_overCap_dropsNonHeldFirstThenHeld', () => {
  const held = Array.from({ length: 3 }, (_, i) => makeEntry({ id: `h${i}`, disposition: 'held', receivedAt: NOW - i }))
  const rest = Array.from({ length: LEDGER_CAP }, (_, i) => makeEntry({ id: `n${i}`, receivedAt: NOW - 100 - i }))
  const result = pruneEntries([...held, ...rest], NOW)
  expect(result.entries).toHaveLength(LEDGER_CAP)
  expect(result.droppedHeld).toBe(0)
  expect(result.entries.filter((entry) => entry.disposition === 'held')).toHaveLength(3)
})

test('test_pruneEntries_onlyHeldOverCap_countsDroppedHeld', () => {
  const held = Array.from({ length: LEDGER_CAP + 2 }, (_, i) => makeEntry({ id: `h${i}`, disposition: 'held', receivedAt: NOW - i }))
  const result = pruneEntries(held, NOW)
  expect(result.entries).toHaveLength(LEDGER_CAP)
  expect(result.droppedHeld).toBe(2)
})

test('test_appendEntry_knownId_isNotNew', () => {
  const first = appendEntry([], makeEntry())
  expect(first.isNew).toBe(true)
  const again = appendEntry(first.entries, makeEntry({ disposition: 'woken' }))
  expect(again.isNew).toBe(false)
  expect(again.entries).toEqual(first.entries)
})

test('test_markRead_andMarkHanded_patchOnlyTheNamedIds', () => {
  const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
  expect(markRead(entries, ['a']).map((entry) => entry.state)).toEqual(['read', 'unread'])
  const handed = at(markHanded(entries, ['b']), 1)
  expect([handed.disposition, handed.state]).toEqual(['handed', 'read'])
})

test('test_applyRequests_freshRequests_areAppliedOnce', () => {
  const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
  const requests = [
    { id: 'r1', kind: 'read' as const, entryId: 'a', at: 1 },
    { id: 'r2', kind: 'handed' as const, entryId: 'b', at: 2 }
  ]
  const first = applyRequests(entries, requests, [])
  expect(at(first.entries, 0).state).toBe('read')
  expect(at(first.entries, 1).disposition).toBe('handed')
  expect(first.applied).toEqual(['r1', 'r2'])
  expect(at(applyRequests(entries, requests, ['r1']).entries, 0).state).toBe('unread')
})

test('test_applyRequests_appliedIdsGone_fromTheFile_areForgotten', () => {
  const result = applyRequests([], [{ id: 'r2', kind: 'read', entryId: 'x', at: 1 }], ['r1'])
  expect(result.applied).toEqual(['r2'])
})

test('test_readToolTarget_rineRead_returnsMessageId', () => {
  expect(readToolTarget('mcp__plugin_rine_rine__rine_read', { message_id: 'm-9' })).toBe('m-9')
})

test('test_readToolTarget_otherToolOrBadInput_isNull', () => {
  expect(readToolTarget('mcp__plugin_rine_rine__rine_send', { message_id: 'm-9' })).toBeNull()
  expect(readToolTarget('Read', { message_id: 'm-9' })).toBeNull()
  expect(readToolTarget('mcp__plugin_rine_rine__rine_read', { message_id: 4 })).toBeNull()
  expect(readToolTarget('mcp__plugin_rine_rine__rine_read', { message_id: '' })).toBeNull()
})

test('test_mirrorLedger_freshNotifiedAfterBaseline_isReportedOnce', () => {
  const file: LedgerFile = {
    v: 1,
    appliedRequests: [],
    entries: [
      makeEntry({ id: 'before', receivedAt: 5 }),
      makeEntry({ id: 'new', receivedAt: 50 }),
      makeEntry({ id: 'quiet', receivedAt: 60, disposition: 'silent' }),
      makeEntry({ id: 'woke', receivedAt: 70, disposition: 'woken' })
    ]
  }
  const first = mirrorLedger([], file, 10)
  expect(first.fresh.map((entry) => entry.id)).toEqual(['new', 'woke'])
  expect(first.entries).toHaveLength(4)
  expect(mirrorLedger(first.entries, file, 10).fresh).toEqual([])
})

test('test_summarizeBacklog_countsArrivedAndCarriedUnread', () => {
  const entries = [
    makeEntry({ id: 'a', disposition: 'backlog', receivedAt: 3 }),
    makeEntry({ id: 'b', disposition: 'notified', receivedAt: 2 }),
    makeEntry({ id: 'c', disposition: 'notified', receivedAt: 1 }),
    makeEntry({ id: 'd', disposition: 'backlog', state: 'read' }),
    makeEntry({ id: 'e', disposition: 'backlog', list: 'deny' })
  ]
  const summary = summarizeBacklog(entries, new Set(['b']))
  expect(summary.arrived).toBe(1)
  expect(summary.earlier).toBe(1)
  expect(summary.entries.map((entry) => entry.id)).toEqual(['a', 'b'])
})

test('test_normalizeLedger_badEntriesAreDropped_badShapeIsNull', () => {
  expect(normalizeLedger({ v: 2, entries: [] })).toBeNull()
  expect(normalizeLedger({ v: 1, entries: [makeEntry(), { id: 5 }], appliedRequests: ['r', 3] })).toEqual({
    v: 1,
    entries: [makeEntry()],
    appliedRequests: ['r']
  })
})

test('test_normalizeLedger_entryWithoutTheWebhookFlag_loadsAsNotAWebhook', () => {
  const { isWebhook: _flag, ...old } = makeEntry()
  expect(normalizeLedger({ v: 1, entries: [old], appliedRequests: [] })?.entries[0]?.isWebhook).toBe(false)
})

test('test_normalizeLedger_webhookEntry_keepsTheFlag', () => {
  expect(normalizeLedger({ v: 1, entries: [makeEntry({ isWebhook: true })], appliedRequests: [] })?.entries[0]?.isWebhook).toBe(true)
})
