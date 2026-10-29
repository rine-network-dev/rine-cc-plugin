import { expect, test } from 'claude-code/testing'
import { FINDINGS_LIMIT, addOrgFinding, findingsView } from '../hooks/lib/org-findings'
import { addOrgRow, emptyOrgStore } from '../hooks/lib/org-window'
import { CONTRACT_ROWS } from './org-kit'

const ESC = String.fromCharCode(27)

const found = (groupId: string, sentence: string, gapKey = sentence) => ({ kind: 'finding', groupId, gapKey, sentence }) as const

test('test_addOrgFinding_sameGroupAndSentence_isKeptOnceAndOtherGroupsAreNot', () => {
  const store = emptyOrgStore()
  addOrgFinding(store, found('g-1', 'No key copy.'))
  addOrgFinding(store, found('g-2', 'No key copy.'))
  addOrgFinding(store, found('g-1', 'No key copy.'))
  expect(store.findings.map((one) => one.groupId)).toEqual(['g-2', 'g-1'])
})

test('test_addOrgFinding_sameSentenceButDifferentGap_isKeptTwice', () => {
  const store = emptyOrgStore()
  addOrgFinding(store, found('g-1', 'Bad copy.', '["EscrowInvalid",3,"u",null,null]'))
  addOrgFinding(store, found('g-1', 'Bad copy.', '["EscrowInvalid",5,"u",null,null]'))
  addOrgFinding(store, found('g-1', 'Bad copy.', '["EscrowInvalid",5,"u",null,null]'))
  expect(store.findings.length).toBe(2)
})

test('test_addOrgFinding_pastTheLimit_dropsTheOldest', () => {
  const store = emptyOrgStore()
  for (let at = 0; at <= FINDINGS_LIMIT; at += 1) addOrgFinding(store, found('g-1', `sentence ${at}`))
  expect(store.findings).toHaveLength(FINDINGS_LIMIT)
  expect(store.findings[0]?.sentence).toBe(`sentence ${FINDINGS_LIMIT}`)
  expect(store.findings.at(-1)?.sentence).toBe('sentence 1')
})

test('test_findingsView_groupKnownToALoadedRow_namesItsHandleOnceElseTheBareShortId', () => {
  const store = emptyOrgStore()
  const [row] = CONTRACT_ROWS
  if (row === undefined) throw new Error('the feed contract has no row')
  const groupId = 'beef0000-0000-4000-8000-000000000003'
  addOrgRow(store, { ...row, message: { ...row.message, groupId, groupHandle: '#ops@acme.rine.network' } })
  addOrgFinding(store, found('c0ffee00-0000-4000-8000-000000000001', 'First.'))
  addOrgFinding(store, found(groupId, 'Second.'))
  expect(findingsView(store, 200, true).lines).toEqual(['In #ops@acme: Second.', 'In c0ffee00: First.'])
})

test('test_findingsView_noFindings_isEmptyAndOtherwiseCountsAndSaysTheLatest', () => {
  const store = emptyOrgStore()
  expect(findingsView(store, 200, true)).toEqual({ bar: [], lines: [] })
  addOrgFinding(store, found('abcdefgh-1', 'One.'))
  expect(findingsView(store, 200, false)).toEqual({ bar: ['1 finding · f lists them · In abcdefgh: One.'], lines: [] })
  addOrgFinding(store, found('abcdefgh-1', 'Two.'))
  expect(findingsView(store, 200, true).bar).toEqual(['2 findings · f lists them · In abcdefgh: Two.'])
})

test('test_findingsView_controlCharactersAndWideText_areScrubbedAndClipped', () => {
  const store = emptyOrgStore()
  addOrgFinding(store, found('g-1', `${ESC}[31mred${ESC}[0m ${'x'.repeat(100)}`))
  const { lines } = findingsView(store, 40, true)
  expect(lines.join('')).not.toContain(ESC)
  for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(40)
  expect(lines.length).toBeGreaterThan(1)
  expect(findingsView(store, 30, false).bar.join('')).not.toContain(ESC)
})
