import type { RenderNode } from 'claude-code'
import { displayWidth, safeLine } from '../lib/sanitize'
import type { Tone } from '../lib/tone'
import { toned, type Ui } from './cells'

/** A stretch of text in one tone. Runs are clipped as a line, so the line never measures past its columns. */
export type Run = { text: string; tone?: Tone; isBold?: boolean }

const EDGES = /^( *)(.*?)( *)$/s

/** One run's text through `safeLine`, which trims: the spaces the run frames its words with are kept, within `cells`. */
function clipText(text: string, cells: number): string {
  const [, lead = '', core = '', trail = ''] = EDGES.exec(text) ?? []
  if (core === '') return ' '.repeat(Math.min(text.length, cells))
  const room = cells - lead.length - trail.length
  return room < 1 ? '' : `${lead}${safeLine(core, room)}${trail}`
}

/** The runs cut to `columns` cells in order, each through `safeLine`; a run that no longer fits is dropped. */
export function clipRuns(runs: readonly Run[], columns: number): Run[] {
  let left = columns
  const kept: Run[] = []
  for (const run of runs) {
    const text = left < 1 ? '' : clipText(run.text, left)
    if (text === '') continue
    kept.push({ ...run, text })
    left -= displayWidth(text)
  }
  return kept
}

const widthOf = (runs: readonly Run[]): number => runs.reduce((sum, run) => sum + displayWidth(run.text), 0)

const nodesOf = (ui: Ui, key: string, runs: readonly Run[]): RenderNode[] =>
  runs.map((run, at) => toned(ui, `${key}-${at}`, run.text, run.tone, run.isBold))

/** One row of tonal runs, clipped to `columns`. */
export function runsLine(ui: Ui, key: string, runs: readonly Run[], columns: number) {
  const { Box } = ui
  return (
    <Box key={key} flexDirection="row">
      {nodesOf(ui, key, clipRuns(runs, columns))}
    </Box>
  )
}

/**
 * Cells the pane's top row leaves free for Claude Code's close mark: one `✕` (U+2715) drawn absolutely at the pane's top right
 * (read from the Claude Code 2.1.295 bundle in the rig image: a Box at `top: 0, right: inset` holding a one-glyph unpadded button, `right: 1` when bordered; the geometry is the same as 2.1.287's).
 */
export const CLOSE_CELLS = 1

/**
 * A header row: `left` at the left edge, and at the right edge `lead` (a node exactly `leadCells` wide, such as the live
 * dot) followed by `right`. The left side gives way first when the row is narrow.
 */
export function headerRow(ui: Ui, key: string, spec: { left: readonly Run[]; right: readonly Run[]; lead?: RenderNode; leadCells?: number; columns: number }) {
  const { Box, Text } = ui
  const leadCells = spec.lead === undefined ? 0 : (spec.leadCells ?? 1)
  const right = clipRuns(spec.right, Math.max(0, spec.columns - leadCells))
  const rightCells = leadCells + widthOf(right)
  const left = clipRuns(spec.left, Math.max(0, spec.columns - rightCells - 1))
  const pad = Math.max(1, spec.columns - widthOf(left) - rightCells)
  return (
    <Box key={key} flexDirection="row">
      {nodesOf(ui, `${key}-l`, left)}
      <Text key={`${key}-pad`}>{' '.repeat(pad)}</Text>
      {spec.lead}
      {nodesOf(ui, `${key}-r`, right)}
    </Box>
  )
}

/** `▌ Held for review · 1 ────────`: a teal bar, the title, and a dim rule to the right edge. */
export function sectionHeader(ui: Ui, key: string, title: string, columns: number, isDim = false) {
  const head = clipRuns([{ text: '▌', tone: isDim ? 'dim' : 'brand' }, { text: ` ${title} `, tone: isDim ? 'dim' : 'plain' }], columns)
  return runsLine(ui, key, [...head, { text: '─'.repeat(Math.max(0, columns - widthOf(head))), tone: 'dim' }], columns)
}

/** A dim hint line, scrubbed and clipped. */
export const hintLine = (ui: Ui, key: string, text: string, columns: number) => runsLine(ui, key, [{ text, tone: 'dim' }], columns)
