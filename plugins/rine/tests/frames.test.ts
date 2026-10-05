import { test, expect } from 'claude-code/testing'
import { MAX_LINE_CHARS, createLineBuffer, parseFrame, type Frame } from '../hooks/lib/frames'
import { at } from './at'
import { heartbeatLine, lifecycleLine, messageLine } from './frame-lines'

function collect(chunks: string[]): Frame[] {
  const buffer = createLineBuffer()
  return chunks.flatMap((chunk) => Array.from(buffer.push(chunk)))
}

function messageOf(line: string) {
  const frame = parseFrame(line)
  if (frame.kind !== 'message') throw new Error('not a message frame: ' + frame.kind)
  return frame.message
}

test('test_push_lineSplitAcrossChunks_rejoinsOnLastChunk', () => {
  const line = messageLine()
  const buffer = createLineBuffer()
  expect(Array.from(buffer.push(line.slice(0, 20)))).toHaveLength(0)
  expect(Array.from(buffer.push(line.slice(20, 60)))).toHaveLength(0)
  const frames = Array.from(buffer.push(line.slice(60)))
  expect(frames).toHaveLength(1)
  expect(at(frames, 0).kind).toBe('message')
})

test('test_push_severalLinesInOneChunk_yieldsInOrder', () => {
  const frames = collect([lifecycleLine('connecting') + lifecycleLine('connected') + heartbeatLine()])
  expect(frames.map((frame) => frame.kind)).toEqual(['lifecycle', 'lifecycle', 'heartbeat'])
})

test('test_push_blankAndCrlfLines_skipsBlankTrimsCr', () => {
  const frames = collect(['\n   \n' + heartbeatLine().replace('\n', '\r\n') + '\n'])
  expect(frames).toEqual([{ kind: 'heartbeat' }])
})

test('test_push_consumerStopsEarly_restNotParsed', () => {
  const buffer = createLineBuffer()
  const seen: Frame[] = []
  for (const frame of buffer.push(heartbeatLine().repeat(10))) {
    seen.push(frame)
    if (seen.length === 2) break
  }
  expect(seen).toHaveLength(2)
})

test('test_parseFrame_messageDataString_parsedTwice', () => {
  const message = messageOf(messageLine())
  expect(message).toEqual({
    id: 'm-1',
    fromAgentId: 'agent-b',
    senderHandle: 'bob@acme.rine.network',
    type: 'rine.v1.dm',
    direction: 'received',
    conversationId: 'c-1',
    encryption: 'hpke-v1',
    createdAt: '2026-10-02T10:00:00Z',
    groupId: null,
    groupHandle: null
  })
})

test('test_parseFrame_messageDataObject_acceptedAsIs', () => {
  const data = { id: 'm-2', from_agent_id: 'agent-c', type: 'rine.v1.dm' }
  const message = messageOf(JSON.stringify({ event: 'message', data }))
  expect(message.id).toBe('m-2')
  expect(message.fromAgentId).toBe('agent-c')
})

test('test_parseFrame_messageIdOnlyOnEnvelope_usesEnvelopeId', () => {
  const data = JSON.stringify({ from_agent_id: 'agent-c', type: 'rine.v1.dm' })
  expect(messageOf(JSON.stringify({ event: 'message', id: 'env-9', data })).id).toBe('env-9')
})

test('test_parseFrame_groupMessage_mapsGroupFields', () => {
  const message = messageOf(
    messageLine({
      group_id: '3713e257-0000-4000-8000-000000000001',
      group_handle: '#wp0g@acme.rine.network',
      recipient_handle: null,
      to_agent_id: null,
      encryption_version: 'sender-key-v1'
    })
  )
  expect(message.groupId).toBe('3713e257-0000-4000-8000-000000000001')
  expect(message.groupHandle).toBe('#wp0g@acme.rine.network')
  expect(message.type).toBe('rine.v1.dm')
  expect(message.senderHandle).toBe('bob@acme.rine.network')
  expect(message.direction).toBe('received')
})

test('test_parseFrame_oneToOneMessage_groupFieldsNull', () => {
  const message = messageOf(messageLine())
  expect(message.groupId).toBeNull()
  expect(message.groupHandle).toBeNull()
})

test('test_parseFrame_messageMissingFromAgentId_invalidShape', () => {
  expect(parseFrame(messageLine({ from_agent_id: undefined }))).toEqual({ kind: 'invalid', reason: 'shape' })
})

test('test_parseFrame_messageDataNotJson_invalidJson', () => {
  expect(parseFrame(JSON.stringify({ event: 'message', id: 'm', data: 'not json' }))).toEqual({
    kind: 'invalid',
    reason: 'json'
  })
})

test('test_parseFrame_malformedJson_invalidJsonNoThrow', () => {
  expect(parseFrame('{"event":')).toEqual({ kind: 'invalid', reason: 'json' })
  expect(parseFrame('garbage')).toEqual({ kind: 'invalid', reason: 'json' })
})

test('test_parseFrame_nonObjectJson_invalidShape', () => {
  for (const line of ['42', 'null', '[]', '{"event":3}']) {
    expect(parseFrame(line)).toEqual({ kind: 'invalid', reason: 'shape' })
  }
})

test('test_parseFrame_heartbeat_heartbeat', () => {
  expect(parseFrame(heartbeatLine().trim())).toEqual({ kind: 'heartbeat' })
})

test('test_parseFrame_lifecycleAllStates_lifecycle', () => {
  for (const state of ['connecting', 'connected', 'reconnecting', 'stopped']) {
    expect(parseFrame(lifecycleLine(state).trim())).toEqual({ kind: 'lifecycle', state })
  }
})

test('test_parseFrame_unknownLifecycleState_ignored', () => {
  expect(parseFrame(lifecycleLine('exploded').trim())).toEqual({ kind: 'ignored', event: 'lifecycle' })
})

test('test_parseFrame_statusAndGroupMembership_ignoredWithEventName', () => {
  const status = JSON.stringify({ event: 'status', data: { conversation_id: 'c', status: 'closed' } })
  const membership = JSON.stringify({ event: 'group_membership', data: { group_id: 'g' } })
  expect(parseFrame(status)).toEqual({ kind: 'ignored', event: 'status' })
  expect(parseFrame(membership)).toEqual({ kind: 'ignored', event: 'group_membership' })
})

test('test_push_oversizedLineInOneChunk_oneInvalidThenNextLineParses', () => {
  const frames = collect(['x'.repeat(MAX_LINE_CHARS + 1) + '\n' + heartbeatLine()])
  expect(frames).toEqual([{ kind: 'invalid', reason: 'oversized' }, { kind: 'heartbeat' }])
})

test('test_push_oversizedLineAcrossChunks_oneInvalidAndRestOfLineSkipped', () => {
  const frames = collect(['x'.repeat(MAX_LINE_CHARS + 1), 'yyyy\n' + heartbeatLine()])
  expect(frames).toEqual([{ kind: 'invalid', reason: 'oversized' }, { kind: 'heartbeat' }])
})

test('test_push_lineExactlyMaxChars_notOversized', () => {
  const head = '{"event":"heartbeat","data":"'
  const tail = '"}'
  const line = head + ' '.repeat(MAX_LINE_CHARS - head.length - tail.length) + tail
  expect(line).toHaveLength(MAX_LINE_CHARS)
  expect(collect([line + '\n'])).toEqual([{ kind: 'heartbeat' }])
})
