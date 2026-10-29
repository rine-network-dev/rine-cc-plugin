import type { OrgRow as WireRow } from './org-row'
import { EQUIVOCATION_SENTENCE, verdictMark, verdictTone } from './org-mark'
import { GROUP_JOINT, fitFromTo, fitGroupSender } from './fit-party'
import { displayWidth, safeBlock, safeLine, scrubNotes } from './sanitize'
import { HANDLE_SCRUB_CELLS, fittedHandle, shownHandle } from './shown-handle'
import type { Tone } from './tone'

export const LINE_CELLS = 160
export const BODY_CHARS = 4000
/** The most detail lines kept; the cap keeps a body of bare newlines from becoming thousands of lines. */
const DETAIL_LINES = 300
/** The most cells a list row's parties take. */
export const PARTIES_CELLS = 30
const SHORT_ID_CELLS = 8

/** One row of the list, every string scrubbed and clipped; `createdAt` is dated by whoever draws it. */
export type OrgWindowRow = {
  id: string
  /** `alice → bob@corp`, or `#ops · alice` for a group post. */
  parties: string
  snippet: string
  snippetTone: Extract<Tone, 'plain' | 'dim' | 'warning'>
  createdAt: string
  /** The verdict's one-cell character, kept on every row. */
  mark: string
  tone: Tone
  equivocal: boolean
}

export type OrgDetailParty = { name: string; shortId: string }
export type OrgDetail = {
  id: string
  createdAt: string
  type: string
  from: OrgDetailParty
  to: OrgDetailParty | null
  group: string | null
  /** The verdict's mark and the CLI's words for it (empty when it said none). */
  mark: string
  tone: Tone
  verdict: string
  equivocal: boolean
  lines: string[]
  notes: string[]
  top: number
}

/** A row as the store keeps it: the wire row without its frame kind. */
export type OrgRow = Omit<WireRow, 'kind'>

const NO_HANDLE = '(no handle)'

type Parties = { from: string; to: string | null; group: string | null }

/** The CLI's own short form when it sent one (an older CLI sends none); else the handle shortened against the org's slug. */
const nameOf = (label: string | null, handle: string | null, ownSlug: string | null, cap: number): string =>
  label !== null ? fittedHandle(label, cap) : shownHandle(handle ?? NO_HANDLE, ownSlug, cap)

const groupOf = ({ message, display }: OrgRow, ownSlug: string | null, cap: number): string | null =>
  message.to === null ? nameOf(display.groupLabel, message.groupHandle ?? 'group', ownSlug, cap) : null

/** Both parties, each fitted to `cap` cells: a list row passes room for any handle so the fitter sees its `@domain`. */
function partiesOf(row: OrgRow, ownSlug: string | null, cap: number): Parties {
  const { message, display } = row
  return {
    from: nameOf(display.fromLabel, message.from.handle, ownSlug, cap),
    to: message.to === null ? null : nameOf(display.toLabel, message.to.handle, ownSlug, cap),
    group: groupOf(row, ownSlug, cap)
  }
}

function snippetOf({ display }: OrgRow): Pick<OrgWindowRow, 'snippet' | 'snippetTone'> {
  const clip = (text: string): string => safeLine(text, LINE_CELLS)
  if (display.gapSentence !== null) return { snippet: clip(display.gapSentence), snippetTone: 'warning' }
  if (display.snippet !== '') return { snippet: clip(display.snippet), snippetTone: 'plain' }
  return { snippet: clip(display.verificationLabel ?? ''), snippetTone: 'dim' }
}

const FROM_TO_JOINT = ' → '

/** The row's parties in at most `PARTIES_CELLS`: `#group · sender`, or `from → to`; each side fitted by `fitHandle`. */
function partiesText({ from, to, group }: Parties): string {
  const joint = group !== null ? GROUP_JOINT : FROM_TO_JOINT
  const room = PARTIES_CELLS - displayWidth(joint)
  const [lead, tail] = group !== null ? fitGroupSender(group, from, room) : fitFromTo(from, to ?? NO_HANDLE, room)
  return `${lead}${joint}${tail}`
}

export function rowOf(row: OrgRow, ownSlug: string | null): OrgWindowRow {
  return {
    id: row.message.id,
    parties: partiesText(partiesOf(row, ownSlug, HANDLE_SCRUB_CELLS)),
    ...snippetOf(row),
    createdAt: row.message.createdAt,
    mark: verdictMark(row.display.glyph),
    tone: verdictTone(row.display.glyph),
    equivocal: row.message.equivocation
  }
}

const partyOf = (name: string, agentId: string): OrgDetailParty => ({ name, shortId: agentId.slice(0, SHORT_ID_CELLS) })

export function detailOf(row: OrgRow, ownSlug: string | null, readerTop: number): OrgDetail {
  const { message, display } = row
  const { from, to, group } = partiesOf(row, ownSlug, HANDLE_SCRUB_CELLS)
  const block = safeBlock(display.body ?? display.gapSentence ?? '', BODY_CHARS)
  const all = block.text.split('\n').slice(0, DETAIL_LINES)
  const top = Math.min(Math.max(readerTop, 0), all.length - 1)
  const scrubbed = scrubNotes(block.truncatedChars + row.textTruncated, block.hiddenChars + row.hiddenChars)
  return {
    id: message.id,
    createdAt: message.createdAt,
    type: safeLine(message.type, 40),
    from: partyOf(from, message.from.agentId),
    to: message.to === null || to === null ? null : partyOf(to, message.to.agentId),
    group,
    mark: verdictMark(display.glyph),
    tone: verdictTone(display.glyph),
    verdict: safeLine(display.verificationLabel ?? '', 60),
    equivocal: message.equivocation,
    lines: all.slice(top),
    notes: message.equivocation ? [EQUIVOCATION_SENTENCE, ...scrubbed] : scrubbed,
    top
  }
}
