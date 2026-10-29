import type { RineIdentity, RinePhase } from '../../types/index'
import type { Look } from '../lib/motion'
import { shownHandle } from '../lib/shown-handle'
import type { Ui } from './cells'
import { CLOSE_CELLS, headerRow, runsLine } from './chrome'
import { pulseGlyph } from './glyphs'

const PHASES: Record<RinePhase, string> = {
  off: '○ off',
  connecting: '◌ connecting',
  live: '● live',
  stale: '⚠ no signal',
  backoff: '◌ reconnecting',
  offline: '✕ offline',
  'auth-failed': '✕ auth failed',
  peer: '⇄ another session owns it'
}

const HANDLE_CELLS = 40

export type Header = { identity: RineIdentity; phase: RinePhase; isPreview: boolean; isMuted: boolean; isOwner: boolean }

/** The session's facts under the title, one dim row: `preview off · not muted · owner`. */
export const facts = (info: Header): string =>
  [`preview ${info.isPreview ? 'on' : 'off'}`, info.isMuted ? 'muted' : 'not muted', info.isOwner ? 'owner' : 'not owner'].join(' · ')

/** Two rows: `◆ rine  alice@acme` with the live dot at the right edge (short of the close mark), and the dim facts beneath. */
export function paneHeader(ui: Ui, info: Header, columns: number, look: Look) {
  const { Box } = ui
  const handle = info.identity.handle === null ? 'identity unknown' : shownHandle(info.identity.handle, null, HANDLE_CELLS)
  const [glyph = '', ...label] = Array.from(PHASES[info.phase])
  return (
    <Box key="header" flexDirection="column">
      {headerRow(ui, 'title', {
        left: [{ text: '◆ ', tone: 'brand' }, { text: 'rine', tone: 'brand', isBold: true }, { text: `  ${handle}` }],
        lead: pulseGlyph(ui, 'pulse', glyph, look),
        right: [{ text: label.join(''), tone: 'dim' }],
        columns: columns - CLOSE_CELLS
      })}
      {runsLine(ui, 'facts', [{ text: facts(info), tone: 'dim' }], columns)}
    </Box>
  )
}
