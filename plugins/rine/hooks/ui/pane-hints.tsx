import type { RineEntry } from '../../types/index'
import type { Ui } from './cells'
import { hintLine } from './chrome'

/** Shown while the pane lacks the keyboard: a pane letter then goes to the composer or to the band. */
const KEYS_HINT = 'click here or ctrl+x tab to use the keys'

export type HintSpec = {
  /** The focused entry; undefined when none is. */
  entry: RineEntry | undefined
  isWarned: boolean
}

/** The letters that apply to the focused entry in its state, as `r read · a allow`. */
function hintText({ entry, isWarned }: HintSpec): string {
  if (isWarned) return 'g allow · c cancel · esc close'
  if (entry === undefined) return 'r read · s hand to Claude · e mark read · esc close'
  const trust = entry.group === null ? ['a allow', 'd deny'] : ['g allow group', 'k deny group']
  if (entry.state === 'read' || entry.disposition === 'held') return ['r read', ...trust, 'esc close'].join(' · ')
  return ['r read', 's hand to Claude', 'e mark read', ...(entry.group === null ? ['y reply'] : [])].join(' · ')
}

/** The reminder shown while the pane lacks the keyboard (the org tab keeps it at its top). */
export const keysHint = (ui: Ui, isFocused: boolean, columns: number) => !isFocused && hintLine(ui, 'hint', KEYS_HINT, columns)

/** The last row of the inbox, dim: the letters that apply while the pane has the keyboard, how to get the keyboard while it does not. */
export const contextHint = (ui: Ui, isFocused: boolean, columns: number, spec: HintSpec) =>
  isFocused ? hintLine(ui, 'hint', hintText(spec), columns) : keysHint(ui, isFocused, columns)
