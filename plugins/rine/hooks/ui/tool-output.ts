import { shortType } from '../lib/model-text'
import { isRecord, stringOrNull } from '../lib/narrow'
import { payloadText } from '../lib/preview'
import { TOOL_PATTERN } from '../lib/refs'
import { safeBlock, safeLine, scrubNotes } from '../lib/sanitize'
import { formatDuration } from '../lib/status'

export type CardTool = 'rine_inbox' | 'rine_read' | 'rine_discover'
export type Card = { header: string | null; rows: string[]; body: string | null; notes: string[] }
export type CardContext = { now: number; columns: number }

const CARD_TOOLS: readonly CardTool[] = ['rine_inbox', 'rine_read', 'rine_discover']
const ROWS_SHOWN = 10
const READ_BODY_CHARS = 1200
const BODY_MARK = '│ '

export function cardToolOf(tool: string): CardTool | null {
  const name = TOOL_PATTERN.exec(tool)?.[1]
  return CARD_TOOLS.find((one) => one === name) ?? null
}

function textBlock(value: unknown): string | null {
  if (!isRecord(value) || value.type !== 'text') return null
  return stringOrNull(value.text)
}

function firstText(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null
  for (const block of blocks) {
    const found = textBlock(block)
    if (found !== null) return found
  }
  return null
}

/** The engine's `output` is not measured live, so a string, a block array and an MCP `{ content }` result are all accepted. */
export function parseOutput(output: unknown): Record<string, unknown> | null {
  const raw =
    typeof output === 'string'
      ? output
      : Array.isArray(output)
        ? firstText(output)
        : isRecord(output)
          ? firstText(output.content)
          : null
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function items(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.items) ? data.items.filter(isRecord) : []
}

function joinParts(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join(' · ')
}

function senderOf(item: Record<string, unknown>): string {
  return safeLine(stringOrNull(item.sender_handle) ?? stringOrNull(item.from_agent_id) ?? 'unknown', 32)
}

function groupOf(item: Record<string, unknown>): string | null {
  const group = stringOrNull(item.group_handle)
  return group === null ? null : safeLine(group, 32)
}

function encOf(item: Record<string, unknown>): string | null {
  const enc = stringOrNull(item.encryption_version)
  return enc === null ? null : safeLine(enc, 16)
}

function ageOf(item: Record<string, unknown>, now: number): string | null {
  const created = stringOrNull(item.created_at)
  if (created === null) return null
  const at = Date.parse(created)
  return Number.isNaN(at) ? null : formatDuration(now - at)
}

function statusOf(item: Record<string, unknown>): string | null {
  const status = stringOrNull(item.verification_status)
  return status === null ? null : safeLine(status, 16)
}

type Verdict = { kind: 'verified' | 'forged' | 'sealed'; status: string | null }

/** A row that stayed sealed carries no `verified` at all, so absence is its own verdict. */
function verdictOf(item: Record<string, unknown>): Verdict {
  const status = statusOf(item)
  if (item.verified === true) return { kind: 'verified', status }
  if (item.verified === false) return { kind: 'forged', status }
  return { kind: 'sealed', status }
}

function inboxMark(item: Record<string, unknown>): string {
  const { kind, status } = verdictOf(item)
  if (kind === 'verified') return '✓'
  if (kind === 'forged') return status === null ? '✗' : `✗ ${status}`
  return 'sealed'
}

function readVerdict(item: Record<string, unknown>): string {
  const { kind, status } = verdictOf(item)
  if (kind === 'verified') return 'verified ✓'
  if (kind === 'forged') return status === null ? 'not verified ✗' : `not verified ✗ (${status})`
  return 'sealed'
}

function cappedRows(
  list: readonly Record<string, unknown>[],
  row: (item: Record<string, unknown>) => string
): { rows: string[]; notes: string[] } {
  const more = list.length - ROWS_SHOWN
  return { rows: list.slice(0, ROWS_SHOWN).map(row), notes: more > 0 ? [`+${more} more`] : [] }
}

function warningNotes(data: Record<string, unknown>, context: CardContext): string[] {
  const warning = stringOrNull(data.warning)
  return warning === null ? [] : [`⚠ ${safeLine(warning, context.columns - 2)}`]
}

function pageNotes(data: Record<string, unknown>): string[] {
  const cursor = stringOrNull(data.next_cursor)
  return cursor !== null && cursor !== '' ? ['more on the next page'] : []
}

function inboxRow(item: Record<string, unknown>, context: CardContext): string {
  const row = joinParts([
    `● ${senderOf(item)} ${inboxMark(item)}`,
    shortType(stringOrNull(item.type) ?? ''),
    groupOf(item),
    ageOf(item, context.now),
    encOf(item)
  ])
  return safeLine(row, context.columns)
}

function discoverRow(item: Record<string, unknown>, context: CardContext): string {
  const name = stringOrNull(item.name)
  const tier = typeof item.trust_tier === 'number' ? `tier ${item.trust_tier}` : null
  const parts = [
    safeLine(stringOrNull(item.handle) ?? 'no handle', 40),
    name === null ? null : JSON.stringify(safeLine(name, 38)),
    tier
  ]
  return safeLine(joinParts(parts), context.columns)
}

function readHeader(data: Record<string, unknown>, context: CardContext): string {
  const header = joinParts([
    senderOf(data),
    readVerdict(data),
    groupOf(data),
    shortType(stringOrNull(data.type) ?? ''),
    encOf(data)
  ])
  return safeLine(header, context.columns)
}

function readCard(data: Record<string, unknown>, context: CardContext): Card | null {
  if (stringOrNull(data.id) === null) return null
  const header = readHeader(data, context)
  const shown = payloadText(data.decrypted) ?? stringOrNull(data.decrypt_error)
  if (shown === null) return { header, rows: [], body: null, notes: [] }
  const block = safeBlock(shown, READ_BODY_CHARS)
  const body = block.text.split('\n').map((line) => BODY_MARK + line).join('\n')
  return { header, rows: [], body, notes: scrubNotes(block.truncatedChars, block.hiddenChars) }
}

export function cardOf(tool: CardTool, data: Record<string, unknown>, context: CardContext): Card | null {
  const warning = warningNotes(data, context)
  if (tool === 'rine_read') {
    const card = readCard(data, context)
    return card === null ? null : { ...card, notes: [...warning, ...card.notes] }
  }
  const list = items(data)
  if (list.length === 0) return null
  const { rows, notes } = cappedRows(list, (item) => (tool === 'rine_inbox' ? inboxRow(item, context) : discoverRow(item, context)))
  return { header: null, rows, body: null, notes: [...warning, ...notes, ...pageNotes(data)] }
}
