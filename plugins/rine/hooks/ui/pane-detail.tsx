import type { RineEntry, RineIdentity, RineLists } from '../../types/index'
import { humanTime } from '../lib/human-time'
import { shortType } from '../lib/model-text'
import type { Look } from '../lib/motion'
import type { ReadPreview } from '../lib/preview'
import { safeLine, scrubNotes } from '../lib/sanitize'
import { shownHandle } from '../lib/shown-handle'
import { isoOfMs, localStamp } from '../lib/stamp'
import { wrapText } from '../lib/wrap'
import type { Ui } from './cells'
import { runsLine, type Run } from './chrome'
import { spinnerGlyph } from './glyphs'

const KEY_CELLS = 11
const NAME_CELLS = 40
const ID_CELLS = 8
/** The most text lines drawn under the grid; the rest is counted. */
const TEXT_LINES = 40
const QUOTE = '┃ '

/** What the untrusted-lists banner asks the person to review: every entry of both lists, one per line, as the file holds them now. */
export function listLines(lists: RineLists, columns: number): string[] {
  const lines = (name: string, entries: RineLists['allow']): string[] =>
    entries.length === 0
      ? [`${name}: none`]
      : entries.map((entry) => safeLine(`${name}: ${entry.handle}${entry.agentId === null ? '' : ` (${entry.agentId})`}`, columns))
  return [...lines('allow', lists.allow), ...lines('deny', lists.deny)]
}

const keyed = (key: string): Run => ({ text: key.padEnd(KEY_CELLS), tone: 'dim' })
/** A name with its 8-character agent id dimmed beside it in the reader header. */
const named = (name: string, id: string | null): Run[] => [{ text: name }, ...(id === null ? [] : [{ text: ` ${id.slice(0, ID_CELLS)}`, tone: 'dim' as const }])]
/** The cells a name may take beside the key and the agent id, so the row never clips it past its `@`. */
const nameCellsOf = (columns: number, id: string | null): number => Math.max(1, Math.min(NAME_CELLS, columns - KEY_CELLS - (id === null ? 0 : 1 + Math.min(id.length, ID_CELLS))))

export type DetailSpec = {
  entry: RineEntry
  preview: ReadPreview | undefined
  identity: RineIdentity
  ownSlug: string | null
  look: Look
  columns: number
}

function gridRows({ entry, identity, ownSlug, look, preview, columns }: DetailSpec): [string, Run[]][] {
  const received = isoOfMs(entry.receivedAt)
  const to: [string, Run[]] = entry.group === null
    ? ['To', named(shownHandle(identity.handle ?? 'you', ownSlug, nameCellsOf(columns, identity.agentId)), identity.agentId)]
    : ['Group', named(shownHandle(entry.group, ownSlug, nameCellsOf(columns, entry.groupId)), entry.groupId)]
  const rows: [string, Run[]][] = [
    ['From', named(shownHandle(entry.from, ownSlug, nameCellsOf(columns, entry.fromAgentId)), entry.fromAgentId)],
    to,
    ['Type', [{ text: shortType(entry.type) }]],
    ['Received', [{ text: `${humanTime(received, look.now)} · ${localStamp(received)}` }]],
    ['Encryption', [{ text: entry.encryption ?? '—' }]],
    ['List', [{ text: entry.list }]]
  ]
  if (preview?.status === 'ok') {
    rows.push(['Signature', [preview.isVerified ? { text: '✓ verified', tone: 'success' } : { text: '✗ not verified', tone: 'error' }]])
  }
  return rows
}

/** The focused entry's text, as `preview.ts` scrubbed and capped it; nothing here ever sees a raw body. */
function textTree(ui: Ui, spec: DetailSpec) {
  const { Box, Text } = ui
  const { preview, columns, look } = spec
  if (preview === undefined) return <Text dimColor>Press r to read the focused message.</Text>
  if (preview.status === 'loading') {
    return (
      <Box key="loading" flexDirection="row" gap={1}>
        {spinnerGlyph(ui, 'spinner', look)}
        <Text dimColor>decrypting…</Text>
      </Box>
    )
  }
  if (preview.status === 'error') return <Text dimColor>Could not read this message.</Text>
  const lines = wrapText(preview.text ?? '', Math.max(columns - QUOTE.length, 1))
  const more = lines.length - TEXT_LINES
  return (
    <Box key="text" flexDirection="column">
      {lines.slice(0, TEXT_LINES).map((line, at) => runsLine(ui, `text-${at}`, [{ text: QUOTE, tone: 'dim' }, { text: line }], columns))}
      {more > 0 && runsLine(ui, 'text-more', [{ text: `+${more} more lines`, tone: 'dim' }], columns)}
      {scrubNotes(preview.truncatedChars, preview.hiddenChars).map((note, at) => runsLine(ui, `note-${at}`, [{ text: note, tone: 'dim' }], columns))}
    </Box>
  )
}

/** The key/value grid of the focused entry, then its text. Encryption and list live here, not on the row. */
export function detailTree(ui: Ui, spec: DetailSpec) {
  const { Box } = ui
  return (
    <Box key="detail" flexDirection="column">
      {gridRows(spec).map(([key, value]) => runsLine(ui, `detail:${key}`, [keyed(key), ...value], spec.columns))}
      {textTree(ui, spec)}
    </Box>
  )
}
