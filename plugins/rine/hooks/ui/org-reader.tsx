import { GROUP_JOINT, fitFromTo, fitGroupSender } from '../lib/fit-party'
import { humanTime } from '../lib/human-time'
import { DECODE_MS, decodeLines, type Look } from '../lib/motion'
import type { OrgDetail, OrgDetailParty } from '../lib/org-rows'
import { localStamp } from '../lib/stamp'
import { displayWidth } from '../lib/sanitize'
import { wrapText } from '../lib/wrap'
import { toned, type Ui } from './cells'
import { headerRow, runsLine, type Run } from './chrome'
import { readerOpenedAt } from './pump'

/** The most body rows the reader draws; the rest is counted. */
const READER_ROWS = 24
const RULE = '┃ '

const FROM_TO_JOINT = ' → '
/** A party's agent id as drawn: a space and the short id. */
const idCells = (party: OrgDetailParty): number => 1 + displayWidth(party.shortId)

const partyRuns = (name: string, party: OrgDetailParty): Run[] => [{ text: name }, { text: ` ${party.shortId}`, tone: 'dim' }]

/**
 * `alice 1a2b3c4d → bob@corp 5e6f7a8b`, or `#ops · alice 1a2b3c4d`: both parties, their short ids dimmed. The names are
 * fitted to `room` cells (what the row leaves once the mark, joint, ids and `when` are drawn), so no name is clipped past its `@`.
 */
function partiesOf(detail: OrgDetail, room: number): Run[] {
  const lead: Run[] = [{ text: `${detail.mark} `, tone: detail.tone }]
  if (detail.group !== null) {
    const [group, from] = fitGroupSender(detail.group, detail.from.name, room - GROUP_JOINT.length - idCells(detail.from))
    return [...lead, { text: `${group}${GROUP_JOINT}` }, ...partyRuns(from, detail.from)]
  }
  if (detail.to === null) return [...lead, ...partyRuns(detail.from.name, detail.from)]
  const [from, to] = fitFromTo(detail.from.name, detail.to.name, room - FROM_TO_JOINT.length - idCells(detail.from) - idCells(detail.to))
  return [...lead, ...partyRuns(from, detail.from), { text: FROM_TO_JOINT }, ...partyRuns(to, detail.to)]
}

/** The opened message: header (parties, when), verdict, the body wrapped and resolving from noise, then the dim notes. */
export function readerTree(ui: Ui, detail: OrgDetail, columns: number, look: Look) {
  const { Box } = ui
  const openedAt = readerOpenedAt(detail.id, look.now)
  const age = look.now - openedAt
  const isDecoding = look.isMotion && age < DECODE_MS
  if (isDecoding) look.wake(openedAt + DECODE_MS)
  const wrapped = detail.lines.flatMap((line) => wrapText(line, Math.max(1, columns - RULE.length)))
  const shown = wrapped.slice(0, READER_ROWS)
  const body = isDecoding ? decodeLines(shown, age) : shown
  const more = wrapped.length - shown.length
  const when = `${humanTime(detail.createdAt, look.now)} · ${localStamp(detail.createdAt)}`
  const room = columns - displayWidth(when) - 1 - displayWidth(`${detail.mark} `)
  return (
    <Box key="detail" flexDirection="column">
      {headerRow(ui, 'reader-head', { left: partiesOf(detail, room), right: [{ text: when, tone: 'dim' }], columns })}
      {runsLine(ui, 'reader-verdict', [{ text: detail.verdict === '' ? '' : `${detail.mark} ${detail.verdict}`, tone: detail.tone }, { text: `  ${detail.type}`, tone: 'dim' }], columns)}
      {body.map((line, at) => runsLine(ui, `line-${at}`, [{ text: RULE, tone: 'dim' }, { text: line }], columns))}
      {more > 0 && runsLine(ui, 'more', [{ text: `+${more} more lines`, tone: 'dim' }], columns)}
      {detail.notes.map((text, at) => runsLine(ui, `detail-note-${at}`, [{ text, tone: 'dim' }], columns))}
    </Box>
  )
}
