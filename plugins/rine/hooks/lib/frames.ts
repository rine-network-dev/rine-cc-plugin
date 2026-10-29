import { isRecord, stringOrNull } from './narrow'

export const MAX_LINE_CHARS = 1048576

export type LifecycleState = 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export type StreamMessage = {
  id: string
  fromAgentId: string
  senderHandle: string | null
  type: string
  direction: string | null
  conversationId: string | null
  encryption: string | null
  createdAt: string | null
  groupId: string | null
  groupHandle: string | null
}

export type InvalidReason = 'json' | 'shape' | 'oversized'

export type Frame =
  | { kind: 'lifecycle'; state: LifecycleState }
  | { kind: 'heartbeat' }
  | { kind: 'message'; message: StreamMessage }
  | { kind: 'ignored'; event: string }
  | { kind: 'invalid'; reason: InvalidReason }

type Obj = Record<string, unknown>

const LIFECYCLE_EVENT = 'lifecycle'
const LIFECYCLE_STATES: readonly string[] = ['connecting', 'connected', 'reconnecting', 'stopped']

function tryParse(source: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(source) }
  } catch {
    return { ok: false }
  }
}

function messageFrame(envelope: Obj): Frame {
  let data = envelope.data
  if (typeof data === 'string') {
    const parsed = tryParse(data)
    if (!parsed.ok) return { kind: 'invalid', reason: 'json' }
    data = parsed.value
  }
  if (!isRecord(data)) return { kind: 'invalid', reason: 'shape' }
  const id = stringOrNull(data.id) ?? stringOrNull(envelope.id)
  const fromAgentId = stringOrNull(data.from_agent_id)
  const type = stringOrNull(data.type)
  if (id === null || fromAgentId === null || type === null) return { kind: 'invalid', reason: 'shape' }
  return {
    kind: 'message',
    message: {
      id,
      fromAgentId,
      senderHandle: stringOrNull(data.sender_handle),
      type,
      direction: stringOrNull(data.direction),
      conversationId: stringOrNull(data.conversation_id),
      encryption: stringOrNull(data.encryption_version),
      createdAt: stringOrNull(data.created_at),
      groupId: stringOrNull(data.group_id),
      groupHandle: stringOrNull(data.group_handle)
    }
  }
}

export function parseFrame(line: string): Frame {
  const parsed = tryParse(line)
  if (!parsed.ok) return { kind: 'invalid', reason: 'json' }
  const envelope = parsed.value
  if (!isRecord(envelope) || typeof envelope.event !== 'string') return { kind: 'invalid', reason: 'shape' }
  const event = envelope.event
  if (event === 'heartbeat') return { kind: 'heartbeat' }
  if (event === 'message') return messageFrame(envelope)
  if (event === LIFECYCLE_EVENT && isRecord(envelope.data)) {
    const state = envelope.data.state
    if (typeof state === 'string' && LIFECYCLE_STATES.includes(state)) {
      return { kind: 'lifecycle', state: state as LifecycleState }
    }
  }
  return { kind: 'ignored', event }
}

/** True for a line the server sent. The CLI prints lifecycle lines itself, so those prove nothing about the server, a known state or not. */
export function isServerFrame(frame: Frame): boolean {
  if (frame.kind === 'ignored') return frame.event !== LIFECYCLE_EVENT
  return frame.kind === 'heartbeat' || frame.kind === 'message'
}

export type LineBuffer<T = Frame> = { push: (chunk: string) => Generator<T, void> }

const OVERSIZED: Frame = { kind: 'invalid', reason: 'oversized' }

/** Splits chunks into lines and parses each; with no arguments it parses stream frames. A line over MAX_LINE_CHARS yields `oversized` and is dropped without being parsed. */
export function createLineBuffer(): LineBuffer
export function createLineBuffer<T>(parse: (line: string) => T, oversized: T): LineBuffer<T>
export function createLineBuffer<T>(
  parse: (line: string) => T = parseFrame as (line: string) => T,
  oversized: T = OVERSIZED as T
): LineBuffer<T> {
  let tail = ''
  let isSkipping = false
  return {
    *push(chunk) {
      let from = 0
      for (;;) {
        const cut = chunk.indexOf('\n', from)
        if (cut < 0) {
          if (isSkipping) return
          tail += chunk.slice(from)
          if (tail.length > MAX_LINE_CHARS) {
            tail = ''
            isSkipping = true
            yield oversized
          }
          return
        }
        const line = tail + chunk.slice(from, cut)
        tail = ''
        from = cut + 1
        if (isSkipping) {
          isSkipping = false
        } else if (line.length > MAX_LINE_CHARS) {
          yield oversized
        } else if (line.trim() !== '') {
          yield parse(line.trimEnd())
        }
      }
    }
  }
}
