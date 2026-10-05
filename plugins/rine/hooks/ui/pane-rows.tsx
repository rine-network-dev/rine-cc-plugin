import type { EngineInterface } from 'claude-code'
import type { RineEntry, RinePreview } from '../../types/index'
import { shortType } from '../lib/model-text'
import { safeLine } from '../lib/sanitize'
import { formatDuration } from '../lib/status'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

const DAY_MS = 24 * 60 * 60 * 1000
const SNIPPET_CELLS = 60

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

/** `bob@acme: "first 60…"` needs the decrypted preview; until it arrives the band says so. */
export function snippetOf(preview: RinePreview | undefined): string {
  if (preview === undefined || preview.status === 'loading') return 'decrypting…'
  if (preview.status === 'error' || preview.text === undefined) return 'could not read'
  return `"${safeLine(preview.text, SNIPPET_CELLS)}"`
}

export function senderOf(entry: RineEntry): string {
  const from = safeLine(entry.from, 32)
  return entry.group === null ? from : `${from} in ${safeLine(entry.group, 32)}`
}

export function rowLabel(entry: RineEntry, now: number, isSelected: boolean, columns: number, snippet = ''): string {
  const parts = [senderOf(entry), shortType(entry.type), formatDuration(now - entry.receivedAt)]
  if (entry.encryption !== null) parts.push(safeLine(entry.encryption, 16))
  parts.push(entry.list)
  return safeLine(`${isSelected ? '[•]' : '[ ]'} ${parts.join(' · ')}  ${snippet}`.trimEnd(), Math.max(columns - 2, 8))
}

export type SectionSpec = {
  key: string
  title: string
  entries: readonly RineEntry[]
  isDim: boolean
  now: number
  columns: number
  selected: ReadonlySet<string>
  /** Decrypted first words per held entry id (preview mode only). */
  snippets: ReadonlyMap<string, string>
  onToggle: (id: string) => void | Promise<void>
}

export function sectionTree(ui: Ui, spec: SectionSpec) {
  const { Box, Text, Button } = ui
  if (spec.entries.length === 0) return null
  return (
    <Box key={`section:${spec.key}`} flexDirection="column">
      <Text dimColor={spec.isDim}>{safeLine(`── ${spec.title} (${spec.entries.length}) ──`, spec.columns)}</Text>
      {spec.entries.map((entry) => (
        <Button
          key={`row:${entry.id}`}
          plain
          dimColor={spec.isDim}
          label={rowLabel(entry, spec.now, spec.selected.has(entry.id), spec.columns, spec.snippets.get(entry.id))}
          onPress={() => spec.onToggle(entry.id)}
        />
      ))}
    </Box>
  )
}
