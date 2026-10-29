import type { RineEntry, RineIdentity, RineLists } from '../../types/index'
import type { Look } from '../lib/motion'
import type { ReadPreview } from '../lib/preview'
import { safeLine } from '../lib/sanitize'
import type { Ui } from './cells'
import { GROUP_WARNING } from './pane-actions'
import { actionRows, type ButtonsSpec } from './pane-buttons'
import { detailTree, listLines } from './pane-detail'
import { paneHeader, type Header } from './pane-header'
import { contextHint } from './pane-hints'
import { sectionTree, senderCellsOf, type Sections } from './pane-rows'

export type InboxSpec = {
  columns: number
  look: Look
  isFocused: boolean
  header: Header
  identity: RineIdentity
  ownSlug: string | null
  lists: RineLists
  sections: Sections
  selected: ReadonlySet<string>
  /** Decrypted first words, for the entries whose preview is known. */
  snippets: ReadonlyMap<string, string>
  current: RineEntry | undefined
  preview: ReadPreview | undefined
  onToggle: (id: string) => void | Promise<void>
  buttons: ButtonsSpec
}

/** The inbox pane: header, the lists to confirm, the sections, the focused entry's detail, the buttons in groups and the hint. */
export function inboxTree(ui: Ui, s: InboxSpec) {
  const { Box, Text } = ui
  const { current, columns, buttons } = s
  const sectionSpec = {
    look: s.look,
    columns,
    ownSlug: s.ownSlug,
    senderCells: senderCellsOf([...s.sections.held, ...s.sections.unread, ...s.sections.earlier, ...s.sections.filtered], s.ownSlug),
    selected: s.selected,
    snippets: s.snippets,
    onToggle: s.onToggle
  }
  const isReviewing = !buttons.isTrusted && !buttons.isWarned
  return (
    <Box flexDirection="column">
      {paneHeader(ui, s.header, columns, s.look)}
      {isReviewing && <Text key="untrusted">Lists changed outside /rine — review</Text>}
      {isReviewing && listLines(s.lists, columns).map((text, at) => <Text key={`list-${at}`}>{text}</Text>)}
      {sectionTree(ui, { ...sectionSpec, key: 'held', title: 'Held for review', entries: s.sections.held, isDim: false })}
      {sectionTree(ui, { ...sectionSpec, key: 'unread', title: 'Unread', entries: s.sections.unread, isDim: false })}
      {sectionTree(ui, { ...sectionSpec, key: 'earlier', title: 'Earlier, last 24h', entries: s.sections.earlier, isDim: false })}
      {sectionTree(ui, { ...sectionSpec, key: 'filtered', title: 'Filtered', entries: s.sections.filtered, isDim: true })}
      {current !== undefined && detailTree(ui, { entry: current, preview: s.preview, identity: s.identity, ownSlug: s.ownSlug, look: s.look, columns })}
      {buttons.isWarned && current?.group != null && <Text>{safeLine(GROUP_WARNING(current.group), columns)}</Text>}
      {actionRows(ui, buttons)}
      {contextHint(ui, s.isFocused, columns, { entry: current, isWarned: buttons.isWarned })}
    </Box>
  )
}
