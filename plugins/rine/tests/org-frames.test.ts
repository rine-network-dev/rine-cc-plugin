import { test, expect } from 'claude-code/testing'
import { MAX_LINE_CHARS } from '../hooks/lib/frames'
import { createOrgLineBuffer, parseOrgFrame, type OrgFrame } from '../hooks/lib/org-frames'
import { FEED_CONTRACT_LINES } from './feed-contract'
import { at } from './at'

const SECRET = 'plaintext-canary-7f3a'

function line(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ event, data: { v: 1, ...data } })
}

const party = { agent_id: 'a1b2c3d4-0000', handle: 'ann@acme.rine.network', own: true }

const ROW = line('row', {
  seq: 7,
  message: {
    id: 'm-1',
    created_at: '2026-10-24T10:00:00+00:00',
    type: 'rine.v1.dm',
    direction: 'sent',
    from: party,
    to: { ...party, own: false },
    group: null,
    conversation_id: 'c-1',
    encryption_version: 'mls-v1',
    epoch: 3,
    verification: 'verified',
    equivocation: false,
    gap: null
  },
  display: {
    glyph: '>',
    verification_label: 'verified',
    gap_sentence: null,
    snippet: SECRET,
    body: SECRET,
    from_short: 'a1b2c3d4',
    to_short: 'e5f6a7b8'
  },
  hidden_chars: 2,
  text_truncated: 0
})

function collect(chunks: string[]): OrgFrame[] {
  const buffer = createOrgLineBuffer()
  return chunks.flatMap((chunk) => Array.from(buffer.push(chunk)))
}

test('test_parseOrgFrame_recordedCliStream_everyLineParses', () => {
  const frames = FEED_CONTRACT_LINES.map((text) => parseOrgFrame(text))
  expect(frames.filter((frame) => frame.kind === 'invalid' || frame.kind === 'ignored')).toEqual([])
  expect(new Set(frames.map((frame) => frame.kind))).toEqual(
    new Set(['hello', 'row', 'finding', 'page', 'heartbeat', 'error'])
  )
})

test('test_parseOrgFrame_hello_readsOrgAndPoll', () => {
  const frame = parseOrgFrame(line('hello', { principal: 'org', org_id: 'o-1', poll_s: 10 }))
  expect(frame).toEqual({ kind: 'hello', orgId: 'o-1', pollSeconds: 10, org: null })
})

test('test_parseOrgFrame_helloWithOrg_readsNameAndSlug', () => {
  const org = { name: 'Acme GmbH', slug: 'acme' }
  const frame = parseOrgFrame(line('hello', { principal: 'org', org_id: 'o-1', poll_s: 10, org }))
  expect(frame).toEqual({ kind: 'hello', orgId: 'o-1', pollSeconds: 10, org })
})

test('test_parseOrgFrame_helloWithNullOrg_readsNoOrg', () => {
  const frame = parseOrgFrame(line('hello', { principal: 'org', org_id: 'o-1', poll_s: 10, org: null }))
  expect(frame).toMatchObject({ kind: 'hello', org: null })
})

test('test_parseOrgFrame_helloWithMalformedOrg_isInvalid', () => {
  const frame = parseOrgFrame(line('hello', { principal: 'org', org_id: 'o-1', poll_s: 10, org: { name: 'Acme' } }))
  expect(frame).toEqual({ kind: 'invalid', reason: 'shape' })
})

test('test_parseOrgFrame_rowWithoutLabels_readsThemAsNull', () => {
  const frame = parseOrgFrame(ROW)
  if (frame.kind !== 'row') throw new Error('not a row: ' + frame.kind)
  expect(frame.display).toMatchObject({ fromLabel: null, toLabel: null, groupLabel: null })
})

test('test_parseOrgFrame_rowWithLabels_readsThem', () => {
  const labelled = ROW.replace(
    '"from_short"',
    '"from_label":"bob@globex","to_label":"ann","group_label":"ops","from_short"'
  )
  const frame = parseOrgFrame(labelled)
  if (frame.kind !== 'row') throw new Error('not a row: ' + frame.kind)
  expect(frame.display).toMatchObject({ fromLabel: 'bob@globex', toLabel: 'ann', groupLabel: 'ops' })
})

test('test_parseOrgFrame_rowWithNonStringLabel_isInvalid', () => {
  const frame = parseOrgFrame(ROW.replace('"from_short"', '"from_label":7,"from_short"'))
  expect(frame).toEqual({ kind: 'invalid', reason: 'shape' })
})

test('test_parseOrgFrame_row_readsMessageAndDisplay', () => {
  const frame = parseOrgFrame(ROW)
  if (frame.kind !== 'row') throw new Error('not a row: ' + frame.kind)
  expect(frame.seq).toBe(7)
  expect(frame.message).toMatchObject({ id: 'm-1', epoch: 3, groupId: null, gap: null, encryption: 'mls-v1' })
  expect(frame.message.to).toEqual({ agentId: 'a1b2c3d4-0000', handle: 'ann@acme.rine.network', own: false })
  expect(frame.display).toMatchObject({ snippet: SECRET, body: SECRET, gapSentence: null, fromShort: 'a1b2c3d4' })
  expect(frame.hiddenChars).toBe(2)
})

test('test_parseOrgFrame_rowWithGap_keepsReason', () => {
  const frame = parseOrgFrame(ROW.replace('"gap":null', '"gap":{"reason":"KeysUnavailable","epoch":3}'))
  if (frame.kind !== 'row') throw new Error('not a row: ' + frame.kind)
  expect(frame.message.gap).toEqual({ reason: 'KeysUnavailable' })
})

test('test_parseOrgFrame_otherEvents_parse', () => {
  expect(parseOrgFrame(line('finding', { group_id: 'g-1', gap: { reason: 'Unreadable', epoch: 2 }, sentence: 's' }))).toEqual({
    kind: 'finding',
    groupId: 'g-1',
    gapKey: '["Unreadable",2,null,null,null]',
    sentence: 's'
  })
  expect(parseOrgFrame(line('page', { kind: 'older', count: 4, older_cursor: 'c' }))).toEqual({
    kind: 'page',
    pageKind: 'older',
    count: 4,
    olderCursor: 'c'
  })
  expect(parseOrgFrame(line('heartbeat', { at: 'x', next_poll_s: 10, paused_s: null }))).toEqual({
    kind: 'heartbeat',
    nextPollSeconds: 10,
    pausedSeconds: null
  })
  expect(parseOrgFrame(line('error', { code: 'needs_org_key', sentence: 'No.', retry_s: null }))).toEqual({
    kind: 'error',
    code: 'needs_org_key',
    sentence: 'No.',
    retrySeconds: null
  })
})

test('test_parseOrgFrame_unknownEvent_ignored', () => {
  expect(parseOrgFrame(line('future', {}))).toEqual({ kind: 'ignored', event: 'future' })
  expect(parseOrgFrame(line('constructor', {}))).toEqual({ kind: 'ignored', event: 'constructor' })
})

test('test_parseOrgFrame_wrongVersion_refused', () => {
  const frame = parseOrgFrame(JSON.stringify({ event: 'hello', data: { v: 2, principal: 'org', org_id: 'o', poll_s: 5 } }))
  expect(frame).toEqual({ kind: 'invalid', reason: 'version' })
  expect(parseOrgFrame(JSON.stringify({ event: 'hello', data: {} }))).toEqual({ kind: 'invalid', reason: 'version' })
})

test('test_parseOrgFrame_badJsonOrShape_refusedWithoutTheLine', () => {
  const bad = [
    `{not json ${SECRET}`,
    JSON.stringify({ event: 7, data: { v: 1, note: SECRET } }),
    JSON.stringify({ event: 'row', data: 'nope' }),
    ROW.replace('"seq":7', `"seq":"${SECRET}"`),
    ROW.replace('"own":true', '"own":1'),
    line('page', { kind: SECRET, count: 1, older_cursor: null })
  ]
  const reasons = bad.map((text) => parseOrgFrame(text))
  expect(reasons.map((frame) => frame.kind)).toEqual(Array(bad.length).fill('invalid'))
  for (const frame of reasons) expect(JSON.stringify(frame)).not.toContain(SECRET)
})

test('test_pushLineBuffer_oversizedLine_oneOversizedFrameNoText', () => {
  const huge = 'x'.repeat(MAX_LINE_CHARS + 1)
  const frames = collect([huge.slice(0, 600000), huge.slice(600000) + '\n' + ROW + '\n'])
  expect(frames.map((frame) => frame.kind)).toEqual(['invalid', 'row'])
  expect(at(frames, 0)).toEqual({ kind: 'invalid', reason: 'oversized' })
})

test('test_pushLineBuffer_lineSplitAcrossChunks_rejoins', () => {
  const frames = collect([ROW.slice(0, 50), ROW.slice(50) + '\n\r\n'])
  expect(frames.map((frame) => frame.kind)).toEqual(['row'])
})

test('test_parseOrgFrame_unsafeIds_refusedAsShape', () => {
  const escape = '\x1b[2Jboom'
  const long = 'a'.repeat(257)
  const bad = [
    ROW.replace('"id":"m-1"', `"id":${JSON.stringify(escape)}`),
    ROW.replace('"id":"m-1"', `"id":"${long}"`),
    ROW.replace('"id":"m-1"', '"id":""'),
    ROW.replace('"conversation_id":"c-1"', `"conversation_id":${JSON.stringify(escape)}`),
    ROW.replace('"agent_id":"a1b2c3d4-0000"', `"agent_id":${JSON.stringify(escape)}`),
    ROW.replace('"group":null', `"group":{"id":${JSON.stringify(escape)},"handle":null}`),
    line('finding', { group_id: escape, gap: { reason: 'Unreadable' }, sentence: 's' }),
    line('page', { kind: 'older', count: 1, older_cursor: long }),
    line('page', { kind: 'older', count: 1, older_cursor: 'a b' }),
    line('hello', { principal: 'org', org_id: escape, poll_s: 5 })
  ]
  for (const text of bad) expect(parseOrgFrame(text)).toEqual({ kind: 'invalid', reason: 'shape' })
})
