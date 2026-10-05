import { expect, test } from 'claude-code/testing'
import type { RineEntry, RineLists, RinePrefs } from '../types/index'
import type { HandOffResult } from '../hooks/lib/delivery-wake'
import { createActions, listEntryOf, placementNote, type Edited, type UiEnv } from '../hooks/ui/pane-actions'
import { entry } from './ui-kit'

const NOW = Date.parse('2026-10-02T10:00:00')

type Rig = { env: UiEnv; calls: string[]; prefs: RinePrefs; lists: RineLists }

function rig(over: Partial<UiEnv> = {}, handResult: HandOffResult = { status: 'submitted' }): Rig {
  const state: Rig = {
    calls: [],
    prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: false },
    lists: { allow: [], deny: [] },
    env: {} as UiEnv
  }
  state.env = {
    now: async () => NOW,
    handOff: async (ids) => (state.calls.push(`hand ${ids.join(',')}`), handResult),
    markRead: async (ids) => void state.calls.push(`read ${ids.join(',')}`),
    loadPreview: async (id) => void state.calls.push(`preview ${id}`),
    editPrefs: async (edit) => {
      const next = edit(state.prefs)
      if (next === undefined) return 'unchanged'
      state.prefs = next
      return 'ok'
    },
    editLists: async (edit) => {
      const next = edit(state.lists)
      if (next === undefined) return 'unchanged'
      const edited: Edited = JSON.stringify(next) === JSON.stringify(state.lists) ? 'unchanged' : 'ok'
      state.lists = next
      return edited
    },
    confirmLists: async () => true,
    hasLegacyPause: async () => false,
    reconnect: async () => void state.calls.push('reconnect'),
    takeover: async () => true,
    ...over
  }
  return state
}

const bob = { kind: 'agent', handle: 'bob@acme', agentId: 'agent-bob' } as const
const ops = { kind: 'group', handle: '#ops@acme', agentId: 'g-1' } as const

test('test_hand_selectedIds_goToTheEnvAndSayNothing', async () => {
  const r = rig()
  expect(await createActions(r.env).hand(['a', 'b'])).toBeNull()
  expect(r.calls).toEqual(['hand a,b'])
})

test('test_hand_nothingSelected_saysSoWithoutHandingOver', async () => {
  const r = rig()
  expect(await createActions(r.env).hand([])).toBe('nothing selected')
  expect(r.calls).toEqual([])
})

test('test_hand_emptyResult_saysThereWasNothingToHand', async () => {
  expect(await createActions(rig({}, { status: 'empty' }).env).hand(['a'])).toBe('nothing to hand to Claude')
})

test('test_markRead_andRead_reachTheEnv', async () => {
  const r = rig()
  const actions = createActions(r.env)
  expect(await actions.markRead(['a'])).toBeNull()
  expect(await actions.markRead([])).toBe('nothing selected')
  expect(await actions.read('a')).toBeNull()
  expect(r.calls).toEqual(['read a', 'preview a'])
})

test('test_mute_eachSpec_writesItsDeadlineAndMarksTheChoiceExplicit', async () => {
  const r = rig()
  const actions = createActions(r.env)
  expect(await actions.mute('1h')).toBe('muted for 1h')
  expect(r.prefs).toEqual({ mutedUntil: NOW + 3_600_000, isMuteExplicit: true, isPreview: false })
  expect(await actions.mute('forever')).toBe('muted until you unmute')
  expect(r.prefs.mutedUntil).toBe('forever')
  await actions.mute('off-hours')
  expect(r.prefs.mutedUntil).toBe(new Date(2026, 9, 3, 8).getTime())
})

test('test_unmute_withLegacyPauseFile_saysItIsIgnored', async () => {
  const r = rig({ hasLegacyPause: async () => true })
  r.prefs = { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false }
  expect(await createActions(r.env).unmute()).toBe('unmuted; the old monitor-pause file is now ignored (you can delete it)')
  expect(r.prefs).toEqual({ mutedUntil: null, isMuteExplicit: true, isPreview: false })
})

test('test_setPreview_off_countsTheEntriesThatStayHeld', async () => {
  const r = rig()
  const actions = createActions(r.env)
  expect(await actions.setPreview(true, 0)).toBe('preview on: new messages wait for your review')
  expect(await actions.setPreview(false, 3)).toBe('preview off: 3 held stay held, /rine to hand them over')
  expect(r.prefs.isPreview).toBe(false)
})

test('test_stateWriteFailure_isReportedNotSwallowed', async () => {
  const r = rig({ editPrefs: async () => 'failed', editLists: async () => 'failed' })
  const actions = createActions(r.env)
  expect(await actions.mute('1h')).toBe('could not save: the state folder is read-only')
  expect(await actions.addTo('allow', bob)).toBe('could not save: the state folder is read-only')
})

test('test_addTo_allowAgent_listsItAndDropsItFromDeny', async () => {
  const r = rig()
  r.lists = { allow: [], deny: [bob] }
  expect(await createActions(r.env).addTo('allow', bob)).toBe('bob@acme is on the allow list.')
  expect(r.lists).toEqual({ allow: [bob], deny: [] })
})

test('test_addTo_allowGroup_carriesTheWarning', async () => {
  const text = await createActions(rig().env).addTo('allow', ops)
  expect(text).toBe('#ops@acme is on the allow list. Any member of #ops@acme, including anyone who joins later, can start a turn.')
})

test('test_addTo_fullList_refusesAtTwoHundred', async () => {
  const r = rig()
  r.lists = { allow: Array.from({ length: 200 }, (_, i) => ({ kind: 'agent' as const, handle: `a${i}@acme`, agentId: null })), deny: [] }
  expect(await createActions(r.env).addTo('allow', bob)).toBe('the allow list is full')
  expect(r.lists.allow).toHaveLength(200)
})

test('test_removeFrom_absentEntry_saysItWasNotThere', async () => {
  const r = rig()
  r.lists = { allow: [bob], deny: [] }
  const actions = createActions(r.env)
  expect(await actions.removeFrom('allow', bob)).toBe('bob@acme left the allow list')
  expect(await actions.removeFrom('allow', bob)).toBe('bob@acme was not on the allow list')
})

test('test_confirm_reconnect_takeover_answerPlainLines', async () => {
  const r = rig()
  const actions = createActions(r.env)
  expect(await actions.confirm()).toBe('lists confirmed')
  expect(await actions.reconnect()).toBe('reconnecting')
  expect(await actions.takeover()).toBe('this session now owns the inbox')
  const failing = createActions(rig({ confirmLists: async () => false, takeover: async () => false }).env)
  expect(await failing.confirm()).toBe('it did not go through; try again')
  expect(await failing.takeover()).toBe('it did not go through; try again')
})

test('test_listEntryOf_senderAndGroup_pinTheEntrysIds', () => {
  const dm: RineEntry = entry({ from: 'Bob@Acme', fromAgentId: 'agent-bob' })
  const grp: RineEntry = entry({ group: '#ops@acme', groupId: 'g-1' })
  expect(listEntryOf(dm, 'agent')).toEqual({ kind: 'agent', handle: 'bob@acme', agentId: 'agent-bob' })
  expect(listEntryOf(grp, 'group')).toEqual(ops)
  expect(listEntryOf(dm, 'group')).toBeNull()
  expect(listEntryOf(entry({ from: 'not a handle' }), 'agent')).toBeNull()
})

test('test_placementNote_unplaced_quotesTheScrubbedReason', () => {
  expect(placementNote({ isPlaced: true })).toBeNull()
  expect(placementNote({ isPlaced: false, reason: 'too\x1b[31m narrow' })).toBe('the inbox pane did not open: too narrow')
})

test('test_addTo_untrustedLists_saysConfirmIsNeeded', async () => {
  const r = rig()
  const edit = r.env.editLists
  r.env.editLists = async (change) => ((await edit(change)) === 'ok' ? 'untrusted' : 'unchanged')
  const text = await createActions(r.env).addTo('allow', bob)
  expect(text).toContain('bob@acme is on the allow list.')
  expect(text).toContain('press Confirm in the inbox pane before an allow entry can wake Claude')
})
