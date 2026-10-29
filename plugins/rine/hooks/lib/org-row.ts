import { isRecord, stringOrNull } from './narrow'
import { type Obj, type OrgGap, gap, nullableId, nullableNum, num, optionalString, safeId } from './org-fields'

export type OrgParty = { agentId: string; handle: string | null; own: boolean }

export type OrgMessage = {
  id: string
  createdAt: string
  type: string
  direction: string | null
  from: OrgParty
  to: OrgParty | null
  groupId: string | null
  groupHandle: string | null
  conversationId: string | null
  encryption: string | null
  epoch: number | null
  verification: string | null
  equivocation: boolean
  gap: OrgGap | null
}

export type OrgDisplay = {
  glyph: string
  verificationLabel: string | null
  gapSentence: string | null
  snippet: string
  body: string | null
  fromShort: string
  toShort: string
  /** The CLI's short forms against the org's own slug; null when an older CLI does not send them. */
  fromLabel: string | null
  toLabel: string | null
  groupLabel: string | null
}

export type OrgRow = {
  kind: 'row'
  seq: number
  message: OrgMessage
  display: OrgDisplay
  hiddenChars: number
  textTruncated: number
}

function party(value: unknown): OrgParty | undefined {
  if (!isRecord(value)) return undefined
  const agentId = safeId(value.agent_id)
  if (agentId === undefined || typeof value.own !== 'boolean') return undefined
  return { agentId, handle: stringOrNull(value.handle), own: value.own }
}

function message(value: unknown): OrgMessage | undefined {
  if (!isRecord(value)) return undefined
  const from = party(value.from)
  const to = value.to === null ? null : party(value.to)
  const group = value.group === null ? {} : value.group
  const parsedGap = gap(value.gap)
  const epoch = nullableNum(value.epoch)
  const groupId = isRecord(group) ? nullableId(group.id) : null
  const conversationId = nullableId(value.conversation_id)
  const { created_at: createdAt, type } = value
  const id = safeId(value.id)
  if (id === undefined || groupId === undefined || conversationId === undefined) return undefined
  if (typeof createdAt !== 'string' || typeof type !== 'string') return undefined
  if (from === undefined || to === undefined || parsedGap === undefined || epoch === undefined) return undefined
  if (!isRecord(group) || typeof value.equivocation !== 'boolean') return undefined
  return {
    id,
    createdAt,
    type,
    direction: stringOrNull(value.direction),
    from,
    to,
    groupId,
    groupHandle: stringOrNull(group.handle),
    conversationId,
    encryption: stringOrNull(value.encryption_version),
    epoch,
    verification: stringOrNull(value.verification),
    equivocation: value.equivocation,
    gap: parsedGap
  }
}

function display(value: unknown): OrgDisplay | undefined {
  if (!isRecord(value)) return undefined
  const { glyph, snippet, from_short: fromShort, to_short: toShort } = value
  const verificationLabel = optionalString(value.verification_label)
  const gapSentence = optionalString(value.gap_sentence)
  const body = optionalString(value.body)
  const fromLabel = optionalString(value.from_label)
  const toLabel = optionalString(value.to_label)
  const groupLabel = optionalString(value.group_label)
  if (typeof glyph !== 'string' || typeof snippet !== 'string') return undefined
  if (typeof fromShort !== 'string' || typeof toShort !== 'string') return undefined
  if (verificationLabel === undefined || gapSentence === undefined || body === undefined) return undefined
  if (fromLabel === undefined || toLabel === undefined || groupLabel === undefined) return undefined
  return { glyph, verificationLabel, gapSentence, body, snippet, fromShort, toShort, fromLabel, toLabel, groupLabel }
}

/** A `row` event's data, or undefined when any part of it is malformed. */
export function parseRow(data: Obj): OrgRow | undefined {
  const seq = num(data.seq)
  const parsedMessage = message(data.message)
  const parsedDisplay = display(data.display)
  const hiddenChars = num(data.hidden_chars)
  const textTruncated = num(data.text_truncated)
  if (seq === undefined || parsedMessage === undefined || parsedDisplay === undefined) return undefined
  if (hiddenChars === undefined || textTruncated === undefined) return undefined
  return { kind: 'row', seq, message: parsedMessage, display: parsedDisplay, hiddenChars, textTruncated }
}
