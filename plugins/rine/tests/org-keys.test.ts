import { expect, test } from 'claude-code/testing'
import { addOrgFinding } from '../hooks/lib/org-findings'
import { parseKeyPost, takeNewKeys } from '../hooks/lib/org-key-post'
import { keyRowsOf, reduceOrgKey, stepOrgKeys, PAGE_ROWS, type KeyEffect, type KeyEvent, type KeyModel, type KeyRow } from '../hooks/lib/org-keys'
import { addOrgRow, emptyOrgStore, IDLE_VI, ORG_RING_LIMIT } from '../hooks/lib/org-window'
import { applyOrgKeys } from '../hooks/ui/org-keys-input'
import type { OrgTabEnv, OrgTabHost } from '../hooks/ui/org-tab'
import { CONTRACT_ROWS, OLDER_CURSOR, fillOrgStore } from './org-kit'

const rowsOf = (count: number, over: (index: number) => Partial<KeyRow> = () => ({})): KeyRow[] =>
  Array.from({ length: count }, (_, index) => ({ id: `r${index}`, direction: 'internal', text: `agent ${index}`, isMarked: false, ...over(index) }))

/** `ctrl-u` is ctrl plus `u`; anything else is a plain key. */
function eventOf(spec: string): KeyEvent {
  return spec.startsWith('ctrl-') ? { key: spec.slice(5), ctrl: true } : { key: spec }
}

const START: KeyModel = { view: { selectedId: 'r0', scrollTop: 0, isReaderOpen: false }, vi: { ...IDLE_VI } }

/** Feeds the keys one by one and returns the model, the id selected and the effects asked for. */
function run(rows: readonly KeyRow[], keys: readonly string[], from: KeyModel = START) {
  let model = from
  const effects: KeyEffect[] = []
  for (const spec of keys) {
    const next = reduceOrgKey(model, rows, eventOf(spec))
    model = { view: next.view, vi: next.vi }
    effects.push(next.effect)
  }
  return { model, selected: model.view.selectedId, effects }
}

test('test_reduceOrgKey_jAndKAndArrows_moveOneRowAndStopAtTheEnds', () => {
  const rows = rowsOf(3)
  expect(run(rows, ['j', 'j']).selected).toBe('r2')
  expect(run(rows, ['j', 'j', 'j', 'down']).selected).toBe('r2')
  expect(run(rows, ['k']).selected).toBe('r0')
  expect(run(rows, ['j', 'j', 'k', 'up']).selected).toBe('r0')
})

test('test_reduceOrgKey_countBeforeAMove_repeatsItAndZeroAloneIsNothing', () => {
  const rows = rowsOf(30)
  expect(run(rows, ['5', 'j']).selected).toBe('r5')
  expect(run(rows, ['1', '0', 'j']).selected).toBe('r10')
  expect(run(rows, ['0', 'j']).selected).toBe('r1')
  expect(run(rows, ['3', 'x', 'j']).selected).toBe('r1')
})

test('test_reduceOrgKey_ggAndG_goToTheFirstAndLastLoadedRow', () => {
  const rows = rowsOf(5)
  expect(run(rows, ['G']).selected).toBe('r4')
  expect(run(rows, ['G', 'g', 'g']).selected).toBe('r0')
  expect(run(rows, ['G', 'g', 'j']).selected).toBe('r4')
})

test('test_reduceOrgKey_GAtTheLastRow_asksForOlderMessages', () => {
  const rows = rowsOf(3)
  const atLast = run(rows, ['G']).model
  expect(reduceOrgKey(atLast, rows, { key: 'G' }).effect).toBe('older')
  expect(reduceOrgKey(START, rows, { key: 'G' }).view.selectedId).toBe('r2')
})

test('test_reduceOrgKey_halfPageAndPageKeys_moveBySizeAndPgDnStandsInForCtrlD', () => {
  const rows = rowsOf(100)
  const half = PAGE_ROWS / 2
  expect(run(rows, ['pagedown']).selected).toBe(`r${half}`)
  expect(run(rows, ['ctrl-f']).selected).toBe(`r${PAGE_ROWS}`)
  expect(run(rows, ['ctrl-f', 'ctrl-b']).selected).toBe('r0')
  expect(run(rows, ['ctrl-f', 'pageup']).selected).toBe(`r${PAGE_ROWS - half}`)
  expect(run(rows, ['ctrl-f', 'ctrl-u']).selected).toBe(`r${PAGE_ROWS - half}`)
})

test('test_reduceOrgKey_keysThatNeverArriveOrAreMeta_changeNothing', () => {
  const rows = rowsOf(30)
  for (const spec of ['ctrl-d', 'ctrl-x', 'escape', 'constructor', '__proto__']) {
    const out = run(rows, [spec])
    expect(out.selected).toBe('r0')
    expect(out.effects).toEqual(['none'])
  }
  expect(reduceOrgKey(START, rows, { key: 'j', meta: true }).view.selectedId).toBe('r0')
})

test('test_reduceOrgKey_enterAndHAndL_moveFocusBetweenTheListAndTheReader', () => {
  const rows = rowsOf(3)
  const open = run(rows, ['return'])
  expect(open.model.view.isReaderOpen).toBe(true)
  expect(open.model.vi.focus).toBe('reader')
  expect(run(rows, ['return', 'h']).model.vi.focus).toBe('list')
  expect(run(rows, ['return', 'h', 'l']).model.vi.focus).toBe('reader')
  expect(run(rows, ['l']).model.vi.focus).toBe('list')
  expect(run(rows, ['return', 'q']).model.view.isReaderOpen).toBe(false)
})

test('test_reduceOrgKey_jInTheReader_scrollsTheReaderAndLeavesTheSelection', () => {
  const rows = rowsOf(3)
  const out = run(rows, ['return', 'j', 'j', 'k']).model
  expect(out.vi.readerTop).toBe(1)
  expect(out.view.selectedId).toBe('r0')
  expect(run(rows, ['return', 'G']).model.vi.readerTop).toBe(Number.MAX_SAFE_INTEGER)
  expect(run(rows, ['return', 'G', 'g', 'g']).model.vi.readerTop).toBe(0)
})

test('test_reduceOrgKey_searchPrompt_runsOnEnterBacksUpAndCancelsOnEmptyEnter', () => {
  const rows = rowsOf(6, (index) => ({ text: index % 2 === 1 ? 'odd refund' : 'even' }))
  const typing = run(rows, ['/', 'r', 'e', 'f'])
  expect(typing.model.vi.typing).toBe('ref')
  expect(run(rows, ['/', 'r', 'x', 'backspace', 'e', 'f']).model.vi.typing).toBe('ref')
  expect(run(rows, ['/', 'ctrl-j', 'escape']).model.vi.typing).toBe('')
  expect(run(rows, ['/', '\u0007', 'a']).model.vi.typing).toBe('a')
  const found = run(rows, ['/', 'r', 'e', 'f', 'return'])
  expect(found.model.vi).toMatchObject({ typing: null, query: 'ref' })
  expect(found.selected).toBe('r1')
  expect(run(rows, ['/', 'return']).model.vi).toMatchObject({ typing: null, query: '' })
  expect(run(rows, ['/', 'j', 'return']).model.vi.typing).toBeNull()
})

test('test_searchPrompt_aPastedFullHandleOrAShortLabel_findsTheRow', () => {
  const [first] = CONTRACT_ROWS
  if (first === undefined) throw new Error('the contract has no rows')
  const store = emptyOrgStore()
  addOrgRow(store, {
    ...first,
    message: {
      ...first.message,
      from: { ...first.message.from, handle: 'ann@acme.rine.network' },
      to: { agentId: 'b2', handle: 'buyer@fjord21735.rine.network', own: false }
    },
    display: { ...first.display, fromLabel: 'ann', toLabel: 'buyer@fjord21735', groupLabel: null }
  })
  const rows = keyRowsOf(store)
  for (const query of ['ann@acme.rine.network', 'buyer@fjord21735.rine.network', 'buyer@fjord21735']) {
    const found = run(rows, ['/', ...Array.from(query), 'return'], { ...START, view: { ...START.view, selectedId: null } })
    expect(found.model.vi.query).toBe(query)
    expect(found.selected).toBe(rows[0]?.id)
  }
  expect(run(rows, ['/', ...Array.from('buyer@elsewhere'), 'return']).selected).toBe(START.view.selectedId)
})

test('test_reduceOrgKey_GAtTheLastRowOfAFullRing_asksForNothing', () => {
  const rows = rowsOf(ORG_RING_LIMIT)
  const atLast = run(rows, ['G']).model
  expect(reduceOrgKey(atLast, rows, { key: 'G' }).effect).toBe('none')
})

test('test_reduceOrgKey_searchEnter_startsAfterTheCursorAndWraps', () => {
  const rows = rowsOf(6, (index) => ({ text: index % 2 === 1 ? 'odd refund' : 'even' }))
  const from = (id: string): KeyModel => ({ ...START, view: { ...START.view, selectedId: id } })
  expect(run(rows, ['/', 'r', 'e', 'f', 'return'], from('r2')).selected).toBe('r3')
  expect(run(rows, ['/', 'r', 'e', 'f', 'return'], from('r5')).selected).toBe('r1')
})

test('test_reduceOrgKey_emptyEnterInThePrompt_keepsThePreviousQuery', () => {
  const rows = rowsOf(6, (index) => ({ text: index % 2 === 1 ? 'odd refund' : 'even' }))
  const seen = run(rows, ['/', 'r', 'e', 'f', 'return']).model
  const cancelled = run(rows, ['/', 'return'], seen)
  expect(cancelled.model.vi).toMatchObject({ typing: null, query: 'ref' })
  expect(cancelled.selected).toBe('r1')
})

test('test_reduceOrgKey_nAndN_walkTheMatchesAndWrap', () => {
  const rows = rowsOf(6, (index) => ({ text: index % 2 === 1 ? 'odd refund' : 'even' }))
  const seen = run(rows, ['/', 'r', 'e', 'f', 'return']).model
  expect(run(rows, ['n'], seen).selected).toBe('r3')
  expect(run(rows, ['n', 'n', 'n'], seen).selected).toBe('r1')
  expect(run(rows, ['N'], seen).selected).toBe('r5')
  expect(run(rows, ['n'], START).selected).toBe('r0')
})

test('test_reduceOrgKey_bracketKeys_jumpToTheNextAndPreviousGapOrUnverifiedRow', () => {
  const rows = rowsOf(8, (index) => ({ isMarked: index === 2 || index === 6 }))
  expect(run(rows, [']']).selected).toBe('r2')
  expect(run(rows, [']', ']']).selected).toBe('r6')
  expect(run(rows, [']', ']', ']']).selected).toBe('r6')
  expect(run(rows, ['G', '[']).selected).toBe('r6')
  expect(run(rows, ['G', '[', '[']).selected).toBe('r2')
})

test('test_reduceOrgKey_D_cyclesTheDirectionAndKeepsTheSelectionWhenItStillShows', () => {
  const rows = rowsOf(4, (index) => ({ direction: index % 2 === 0 ? 'sent' : 'received' }))
  const all = ['all', 'sent', 'received', 'internal', 'all']
  const seen = ['D', 'D', 'D', 'D'].map((_, count) => run(rows, Array(count + 1).fill('D')).model.vi.direction)
  expect(seen).toEqual(all.slice(1))
  expect(run(rows, ['D']).selected).toBe('r0')
  expect(run(rows, ['j', 'D']).selected).toBe('r0')
  expect(run(rows, ['D', 'D']).selected).toBe('r1')
  expect(run(rows, ['D', 'j']).selected).toBe('r2')
})

test('test_reduceOrgKey_iAndR_askForTheInboxAndAFreshRead', () => {
  const rows = rowsOf(2)
  expect(run(rows, ['i']).effects).toEqual(['inbox'])
  expect(run(rows, ['R']).effects).toEqual(['reread'])
})

test('test_reduceOrgKey_helpOverlay_swallowsKeysUntilQuestionMarkOrQ', () => {
  const rows = rowsOf(3)
  const open = run(rows, ['?', 'j', 'i', 'R'])
  expect(open.model.vi.isHelpOpen).toBe(true)
  expect(open.selected).toBe('r0')
  expect(open.effects).toEqual(['none', 'none', 'none', 'none'])
  expect(run(rows, ['?', '?']).model.vi.isHelpOpen).toBe(false)
  expect(run(rows, ['?', 'q', 'j']).selected).toBe('r1')
})

test('test_reduceOrgKey_findingsList_swallowsKeysUntilFOrQ', () => {
  const rows = rowsOf(3)
  const open = run(rows, ['f', 'j', 'i', 'R'])
  expect(open.model.vi.isFindingsOpen).toBe(true)
  expect(open.selected).toBe('r0')
  expect(open.effects).toEqual(['none', 'none', 'none', 'none'])
  expect(run(rows, ['f', 'f']).model.vi.isFindingsOpen).toBe(false)
  expect(run(rows, ['f', 'q', 'j']).selected).toBe('r1')
})

test('test_stepOrgKeys_fWithNoFindings_opensNothingAndWithOneOpensTheList', () => {
  const store = emptyOrgStore()
  fillOrgStore(store)
  stepOrgKeys(store, [{ key: 'f' }])
  expect(store.vi.isFindingsOpen).toBe(false)
  addOrgFinding(store, { kind: 'finding', groupId: 'g-1', gapKey: 'NoEscrow', sentence: 'No key copy.' })
  stepOrgKeys(store, [{ key: 'f' }])
  expect(store.vi.isFindingsOpen).toBe(true)
  stepOrgKeys(store, [{ key: 'f' }])
  expect(store.vi.isFindingsOpen).toBe(false)
})

test('test_parseKeyPost_malformedPosts_areRefusedAndAGoodOneKeepsItsKeys', () => {
  const key = { seq: 1, key: 'j', ctrl: false }
  expect(parseKeyPost(null)).toBeNull()
  expect(parseKeyPost({ epoch: '', keys: [] })).toBeNull()
  expect(parseKeyPost({ epoch: 'e', keys: 'j' })).toBeNull()
  expect(parseKeyPost({ epoch: 'e', keys: [{ seq: 1.5, key: 'j' }] })).toBeNull()
  expect(parseKeyPost({ epoch: 'e', keys: [{ seq: 1, key: 'x'.repeat(17) }] })).toBeNull()
  expect(parseKeyPost({ epoch: 'e', keys: Array.from({ length: 65 }, (_, seq) => ({ seq, key: 'j' })) })).toBeNull()
  expect(parseKeyPost({ epoch: 'e', keys: [key] })?.keys).toEqual([{ seq: 1, event: { key: 'j', ctrl: false, meta: false } }])
})

test('test_takeNewKeys_repeatedTailAndNewEpoch_deliversEachKeyOnceAndStartsOverOnANewInstance', () => {
  const post = (epoch: string, seqs: number[]) => parseKeyPost({ epoch, keys: seqs.map((seq) => ({ seq, key: String(seq) })) }) as NonNullable<ReturnType<typeof parseKeyPost>>
  const first = takeNewKeys(IDLE_VI, post('a', [1, 2]))
  expect(first.keys.map((k) => k.key)).toEqual(['1', '2'])
  const second = takeNewKeys(first.vi, post('a', [2, 3, 4]))
  expect(second.keys.map((k) => k.key)).toEqual(['3', '4'])
  expect(takeNewKeys(second.vi, post('a', [3, 4])).keys).toEqual([])
  expect(takeNewKeys(second.vi, post('b', [1])).keys.map((k) => k.key)).toEqual(['1'])
})

function tab() {
  const store = emptyOrgStore()
  fillOrgStore(store)
  const calls: string[] = []
  const org: OrgTabEnv = {
    store: () => store,
    sentence: () => null,
    ack: { load: async () => undefined, save: async () => undefined },
    feed: { start: () => void calls.push('start'), stop: () => void calls.push('stop'), loadOlder: async (cursor) => void calls.push(`older ${cursor}`) }
  }
  const host: OrgTabHost = {
    setTab: async (name) => void calls.push(`tab ${name}`),
    setStatus: async () => undefined,
    redraw: async () => void calls.push('redraw'),
    warn: () => undefined
  }
  return { store, calls, org, host }
}

const postOf = (epoch: string, keys: string[], from = 1) => ({ epoch, keys: keys.map((key, at) => ({ seq: from + at, ...eventOf(key) })) })

test('test_applyOrgKeys_postedKeys_moveTheSelectionRedrawOnceAndIgnoreARepeatedPost', async () => {
  const { store, calls, org, host } = tab()
  await applyOrgKeys(org, host, postOf('a', ['j', 'j']))
  expect(store.view.selectedId).toBe(keyRowsOf(store)[1]?.id)
  expect(calls).toEqual(['redraw'])
  await applyOrgKeys(org, host, postOf('a', ['j', 'j']))
  expect(store.view.selectedId).toBe(keyRowsOf(store)[1]?.id)
  expect(store.view.scrollTop).toBe(0)
  await applyOrgKeys(org, host, 'not a post')
  expect(calls).toEqual(['redraw', 'redraw'])
})

test('test_applyOrgKeys_effects_goToTheFeedAndTheInbox', async () => {
  const { calls, org, host } = tab()
  await applyOrgKeys(org, host, postOf('a', ['G', 'G']))
  expect(calls).toEqual(['redraw', `older ${OLDER_CURSOR}`])
  await applyOrgKeys(org, host, postOf('a', ['R', 'i'], 3))
  expect(calls.slice(2)).toEqual(['redraw', 'stop', 'start', 'stop', 'tab inbox'])
})

test('test_applyOrgKeys_keysAfterLeavingForTheInbox_areNotRun', async () => {
  const { calls, org, host } = tab()
  await applyOrgKeys(org, host, postOf('a', ['i', 'R']))
  expect(calls).toEqual(['redraw', 'stop', 'tab inbox'])
})
