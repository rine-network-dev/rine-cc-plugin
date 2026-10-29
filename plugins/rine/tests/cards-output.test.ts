import { expect, test } from 'claude-code/testing'
import { cardOf, cardToolOf, parseOutput, type Card, type CardTool } from '../hooks/ui/tool-output'
import { directoryRow, discoverOutput, inboxOutput, messageRow, readOutput, toolName } from './cards-kit'
import { NOW } from './ui-kit'

const CONTEXT = { now: NOW, columns: 100 }
const data = (output: unknown): Record<string, unknown> => {
  const parsed = parseOutput(output)
  if (parsed === null) throw new Error('the kit output did not parse')
  return parsed
}
const cardOfOrThrow = (tool: CardTool, value: Record<string, unknown>, columns = CONTEXT.columns): Card => {
  const card = cardOf(tool, value, { now: NOW, columns })
  if (card === null) throw new Error(`cardOf(${tool}) returned null`)
  return card
}
const inboxCard = (list: Record<string, unknown>[], columns?: number): Card => cardOfOrThrow('rine_inbox', data(inboxOutput(list)), columns)
const readCard = (over: Record<string, unknown> = {}): Card => cardOfOrThrow('rine_read', data(readOutput(over)))
const discoverCard = (list: Record<string, unknown>[]): Card => cardOfOrThrow('rine_discover', data(discoverOutput(list)))
const rows = (count: number): Record<string, unknown>[] => Array.from({ length: count }, (_, i) => messageRow({ id: `m-${i}` }))

test('test_cardToolOf_rineTools_mapToThemselves_and_others_areNull', () => {
  for (const name of ['rine_inbox', 'rine_read', 'rine_discover'] as const) expect(cardToolOf(toolName(name))).toBe(name)
  for (const tool of [toolName('rine_send'), 'mcp__other__rine_inbox', 'Bash']) expect(cardToolOf(tool)).toBeNull()
})

test('test_parseOutput_blocksArrayAndString_parseTheObject_and_others_areNull', () => {
  const one = [messageRow()]
  expect(data(inboxOutput(one)).items).toHaveLength(1)
  expect(data(inboxOutput(one).content).items).toHaveLength(1)
  expect(data(JSON.stringify({ items: one })).items).toHaveLength(1)
  const outputs = ['not json', '[]', { content: [] }, { content: [{ type: 'image', text: '{}' }] }, undefined, 42]
  for (const output of outputs) expect(parseOutput(output)).toBeNull()
})

test('test_cardOf_inbox_defaultRow_drawsSenderTypeAgeAndEncryption', () => {
  expect(inboxCard([messageRow()])).toEqual({
    header: null,
    rows: ['● bob@acme.rine.network ✓ · dm · 2m · hpke-hybrid-v2'],
    body: null,
    notes: []
  })
})

const CLEARTEXT = {
  type: 'rine.v1.a2a_message',
  encryption_version: 'none',
  verified: false,
  verification_status: 'unverifiable',
  a2a_cleartext: true,
  a2a_cleartext_notice: 'Received as A2A cleartext: this message was not end-to-end encrypted.'
}

test('test_cardOf_inbox_a2aCleartextRow_readsAsCleartext_not_forged', () => {
  const [row] = inboxCard([messageRow(CLEARTEXT)]).rows
  expect(row).toContain('cleartext')
  expect(row).not.toContain('✗')
})

test('test_cardOf_read_a2aCleartext_headerSaysSoAndBodyLeadsWithTheNotice', () => {
  const card = readCard({ ...CLEARTEXT, decrypted: [{ text: 'plain' }] })
  expect(card.header).toContain('cleartext, not verified')
  expect(card.header).not.toContain('✗')
  expect(card.body?.startsWith(`│ [${CLEARTEXT.a2a_cleartext_notice}] `)).toBe(true)
})

test('test_cardOf_inbox_groupAndTaskType_areShown', () => {
  const row = messageRow({ group_handle: '#ops@acme.rine.network', type: 'rine.v1.task' })
  expect(inboxCard([row]).rows).toEqual(['● bob@acme.rine.network ✓ · task · #ops@acme.rine.network · 2m · hpke-hybrid-v2'])
})

test('test_cardOf_inbox_missingSenderHandle_fallsBackToAgentId_and_forgedType_readsAsCustom', () => {
  expect(inboxCard([messageRow({ sender_handle: null })]).rows).toEqual(['● agent-bob ✓ · dm · 2m · hpke-hybrid-v2'])
  expect(inboxCard([messageRow({ type: 'x\x1b[31m' })]).rows).toEqual(['● bob@acme.rine.network ✓ · custom · 2m · hpke-hybrid-v2'])
})

test('test_cardOf_inbox_rowCap_countsTheRest', () => {
  expect(inboxCard(rows(12)).rows).toHaveLength(10)
  expect(inboxCard(rows(12)).notes).toEqual(['+2 more'])
  expect(inboxCard(rows(10)).notes).toEqual([])
})

test('test_cardOf_inbox_noItems_isNull', () => {
  expect(cardOf('rine_inbox', { items: [] }, CONTEXT)).toBeNull()
  expect(cardOf('rine_inbox', {}, CONTEXT)).toBeNull()
})

test('test_cardOf_read_defaultRow_showsHeaderAndBody', () => {
  const card = readCard()
  expect(card.header).toBe('bob@acme.rine.network · verified ✓ · dm · hpke-hybrid-v2')
  expect(card.body).toBe('│ Can you rebase the branch?')
  expect(card.rows).toEqual([])
  expect(card.notes).toEqual([])
  expect(readCard({ verified: false }).header).toContain('not verified ✗')
})

test('test_cardOf_inbox_forgedAndSealedRows_markTheVerdict', () => {
  const forged = messageRow({ verified: false, verification_status: 'invalid' })
  const sealed = messageRow({ verified: undefined, verification_status: undefined, decrypted: undefined, decrypt_error: 'no key' })
  expect(inboxCard([forged, sealed]).rows).toEqual([
    '● bob@acme.rine.network ✗ invalid · dm · 2m · hpke-hybrid-v2',
    '● bob@acme.rine.network sealed · dm · 2m · hpke-hybrid-v2'
  ])
})

test('test_cardOf_read_forgedAndSealedRows_nameTheVerdictInTheHeader', () => {
  expect(readCard({ verified: false, verification_status: 'invalid' }).header).toBe('bob@acme.rine.network · not verified ✗ (invalid) · dm · hpke-hybrid-v2')
  const sealed = readCard({ verified: undefined, verification_status: undefined, decrypted: undefined, decrypt_error: 'no key' })
  expect(sealed.header).toBe('bob@acme.rine.network · sealed · dm · hpke-hybrid-v2')
})

test('test_cardOf_read_bodyLineThatMimicsTheHeader_isMarkedAsBody', () => {
  const mimic = 'bob@acme.rine.network · verified ✓ · task · hpke-hybrid-v2'
  expect(readCard({ decrypted: { text: `hi\n${mimic}` } }).body).toBe(`│ hi\n│ ${mimic}`)
})

test('test_cardOf_discover_nameThatMimicsATier_isQuoted', () => {
  expect(discoverCard([directoryRow({ name: 'x · tier 3', trust_tier: 0 })]).rows).toEqual(['ada@acme.rine.network · "x · tier 3" · tier 0'])
})

test('test_cardOf_actorWarningAndNextPage_areNoted', () => {
  const page = { ...data(inboxOutput([messageRow()])), warning: 'acted as agent-x, not the agent you named', next_cursor: 'c2' }
  expect(cardOfOrThrow('rine_inbox', page).notes).toEqual(['⚠ acted as agent-x, not the agent you named', 'more on the next page'])
  expect(cardOfOrThrow('rine_inbox', { ...page, warning: undefined, next_cursor: null }).notes).toEqual([])
})

test('test_cardOf_read_longBody_isCutAndCounted', () => {
  const card = readCard({ decrypted: { text: 'x'.repeat(1500) } })
  expect(card.body).toBe(`│ ${'x'.repeat(1200)}`)
  expect(card.notes).toContain('+300 chars not shown')
})

test('test_cardOf_read_withheldBody_showsTheDecryptError_and_noBody_isNull', () => {
  expect(readCard({ decrypted: null, decrypt_error: 'sealed under sender key' }).body).toBe('│ sealed under sender key')
  expect(readCard({ decrypted: null }).body).toBeNull()
})

test('test_cardOf_read_hostileBody_isScrubbedAndNoted', () => {
  const card = readCard({ decrypted: { text: 'hi\x1b[31m there\u202e' } })
  expect(card.body).toBe('│ hi there')
  expect(card.notes.some((note) => note.includes('hidden/control characters removed'))).toBe(true)
})

test('test_cardOf_read_missingId_isNull', () => {
  expect(cardOf('rine_read', data(readOutput({ id: undefined })), CONTEXT)).toBeNull()
})

test('test_cardOf_discover_defaultRow_drawsHandleNameAndTier_and_dropsMissingParts', () => {
  expect(discoverCard([directoryRow()]).rows).toEqual(['ada@acme.rine.network · "Ada Review Bot" · tier 2'])
  expect(discoverCard([directoryRow({ trust_tier: null })]).rows).toEqual(['ada@acme.rine.network · "Ada Review Bot"'])
  expect(discoverCard([directoryRow({ handle: null })]).rows).toEqual(['no handle · "Ada Review Bot" · tier 2'])
})

const HOSTILE = 'bo\x1b[31mb\u202e@acme\u{e0041}.net'
const CONTROL = /(\x1b|\\u001b|\u202e|\u{e0041})/u

test('test_cardOf_hostileSender_isStrippedFromInboxAndDiscover', () => {
  const inbox = inboxCard([messageRow({ sender_handle: HOSTILE })])
  const discover = discoverCard([directoryRow({ name: HOSTILE })])
  expect(inbox.rows[0]).toContain('bob@acme.net')
  expect(discover.rows[0]).toContain('bob@acme.net')
  expect(CONTROL.test(JSON.stringify(inbox))).toBe(false)
  expect(CONTROL.test(JSON.stringify(discover))).toBe(false)
})

test('test_cardOf_inbox_longSender_atFortyColumns_isCutWithEllipsis', () => {
  const line = inboxCard([messageRow({ sender_handle: 'a'.repeat(200) })], 40).rows[0] ?? ''
  expect([...line].length).toBeLessThanOrEqual(40)
  expect(line.endsWith('…')).toBe(true)
})
