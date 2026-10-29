import type { RineEntry } from '../../types/index'
import { humanTime } from '../lib/human-time'
import { GROUP_JOINT, fitGroupSender, fitHandle } from '../lib/fit-party'
import { shortType } from '../lib/model-text'
import { SHIMMER_MS, shimmer, type Look } from '../lib/motion'
import type { ReadPreview } from '../lib/preview'
import { displayWidth, safeLine } from '../lib/sanitize'
import { HANDLE_SCRUB_CELLS, shownHandle } from '../lib/shown-handle'
import { isoOfMs } from '../lib/stamp'
import type { Tone } from '../lib/tone'
import { toned, type Ui } from './cells'
import { sectionHeader } from './chrome'
import { FLEX, hugWidth, layoutRow } from './columns'

const DAY_MS = 24 * 60 * 60 * 1000
const SNIPPET_CELLS = 60
const SENDER_MAX = 24
const TAG_CELLS = 6
const DATE_CELLS = 9
/** The selection arrow and the unread dot, two cells each. */
const GUTTER = 4

export const NOT_READ = 'not read yet'

export type Sections = {
  held: RineEntry[]
  unread: RineEntry[]
  earlier: RineEntry[]
  filtered: RineEntry[]
}

/** Held entries stay listed after preview goes off, so the person can still hand them over. */
export function sectionsOf(entries: readonly RineEntry[], now: number): Sections {
  const sections: Sections = { held: [], unread: [], earlier: [], filtered: [] }
  for (const entry of [...entries].sort((a, b) => b.receivedAt - a.receivedAt)) {
    if (entry.list === 'deny') sections.filtered.push(entry)
    else if (entry.state === 'unread') (entry.disposition === 'held' ? sections.held : sections.unread).push(entry)
    else if (now - entry.receivedAt < DAY_MS) sections.earlier.push(entry)
  }
  return sections
}

/** `"first 60…"` needs the decrypted preview; until it arrives the row says so. */
export function snippetOf(preview: ReadPreview | undefined): string {
  if (preview === undefined || preview.status === 'loading') return 'decrypting…'
  if (preview.status === 'error' || preview.text === undefined) return 'could not read'
  return `"${safeLine(preview.text, SNIPPET_CELLS)}"`
}

type Senders = { from: string; group: string | null }

/** The sender, and the group for a group post; both shortened against the reader's own org. */
const sendersOf = (entry: RineEntry, ownSlug: string | null): Senders => ({
  from: shownHandle(entry.from, ownSlug, HANDLE_SCRUB_CELLS),
  group: entry.group === null ? null : shownHandle(entry.group, ownSlug, HANDLE_SCRUB_CELLS)
})

/** Who sent it, led by the group for a group post, fitted to `cells` (the group takes at most 60 %; a handle keeps its `@org`). */
export function senderOf(entry: RineEntry, ownSlug: string | null, cells: number): string {
  const { from, group } = sendersOf(entry, ownSlug)
  if (group === null) return fitHandle(from, cells)
  const [fittedGroup, fittedFrom] = fitGroupSender(group, from, cells - displayWidth(GROUP_JOINT))
  return `${fittedGroup}${GROUP_JOINT}${fittedFrom}`
}

export type SectionSpec = {
  key: string
  title: string
  entries: readonly RineEntry[]
  isDim: boolean
  look: Look
  columns: number
  ownSlug: string | null
  /** The sender column's width, shared by every section so the columns line up. */
  senderCells: number
  selected: ReadonlySet<string>
  /** Decrypted first words per entry id, for the entries whose preview is known. */
  snippets: ReadonlyMap<string, string>
  onToggle: (id: string) => void | Promise<void>
}

/** The sender column's width for a board: the widest sender as written in full, capped. */
export const senderCellsOf = (entries: readonly RineEntry[], ownSlug: string | null): number =>
  hugWidth(
    entries.map((entry) => {
      const { from, group } = sendersOf(entry, ownSlug)
      return group === null ? from : `${group}${GROUP_JOINT}${from}`
    }),
    SENDER_MAX
  )

function rowTree(ui: Ui, spec: SectionSpec, entry: RineEntry) {
  const { Box, Button } = ui
  const { look } = spec
  // Once the optional cells drop the sender is the only live width, so a narrow pane fits it to what the pane has.
  const senderCells = Math.min(spec.senderCells, Math.max(1, spec.columns - GUTTER))
  const [sender = '', tag = '', snippet = '', date = ''] = layoutRow(
    [
      { text: senderOf(entry, spec.ownSlug, senderCells), width: senderCells },
      { text: shortType(entry.type), width: TAG_CELLS, isOptional: true },
      { text: spec.snippets.get(entry.id) ?? NOT_READ, width: FLEX },
      { text: humanTime(isoOfMs(entry.receivedAt), look.now), width: DATE_CELLS, align: 'right', isOptional: true }
    ],
    spec.columns - GUTTER
  )
  const select = spec.selected.has(entry.id) ? '▸ ' : '  '
  const isUnread = entry.state === 'unread'
  const dot = isUnread ? '● ' : '  '
  const age = look.now - entry.receivedAt
  const isArriving = look.isMotion && entry.disposition !== 'backlog' && age >= 0 && age < SHIMMER_MS
  if (isArriving) look.wake(entry.receivedAt + SHIMMER_MS)
  // A Filtered row draws every cell dim, the unread dot included.
  const tone = (own: Tone): Tone => (spec.isDim ? 'dim' : own)
  // One Button per row, so every cell presses the row and the row is one Tab stop. An arriving row shimmers as one label
  // string (Text children cannot shimmer cell by cell); a settled row draws Text children, the unread dot in the brand teal.
  const label = isArriving ? `${select}${dot}${shimmer(`${sender}${tag}${snippet}`, age)}${date}` : undefined
  const cells = isArriving
    ? undefined
    : [
        toned(ui, 'select', select, tone('plain')),
        toned(ui, 'unread', dot, tone(isUnread ? 'brand' : 'plain')),
        toned(ui, 'sender', sender, tone('plain')),
        toned(ui, 'tag', tag, 'dim'),
        toned(ui, 'snippet', snippet, tone(spec.snippets.has(entry.id) ? 'plain' : 'dim')),
        toned(ui, 'date', date, 'dim')
      ]
  return (
    <Box key={`line:${entry.id}`} flexDirection="row">
      <Button key={`row:${entry.id}`} plain dimColor={spec.isDim} label={label} onPress={() => spec.onToggle(entry.id)}>
        {cells}
      </Button>
    </Box>
  )
}

export function sectionTree(ui: Ui, spec: SectionSpec) {
  const { Box } = ui
  if (spec.entries.length === 0) return null
  return (
    <Box key={`section:${spec.key}`} flexDirection="column">
      {sectionHeader(ui, `head:${spec.key}`, `${spec.title} · ${spec.entries.length}`, spec.columns, spec.isDim)}
      {spec.entries.map((entry) => rowTree(ui, spec, entry))}
    </Box>
  )
}
