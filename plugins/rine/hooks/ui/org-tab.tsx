import type { RenderNode } from 'claude-code'
import type { RineOrgPhase, RineOrgStatus, RineOrgTab } from '../../types/index'
import { RINE_CLI_TESTED_FLOOR } from '../lib/mode'
import { FINDINGS_LIMIT, FINDINGS_TRIMMED, findingsView } from '../lib/org-findings'
import { acknowledgeOrg, isOrgAcknowledged, type OrgAckStore } from '../lib/org-ack'
import type { OrgFeed } from '../lib/org-feed'
import { ORG_KEYS_HELP, stepOrgKeys, type KeyEvent } from '../lib/org-keys'
import { windowOf, type OrgStore } from '../lib/org-window'
import type { Look } from '../lib/motion'
import { safeLine } from '../lib/sanitize'
import type { Ui } from './cells'
import { CLOSE_CELLS, headerRow, hintLine, runsLine } from './chrome'
import { pulseGlyph, spinnerGlyph } from './glyphs'
import { orgRows } from './org-list'
import { readerTree } from './org-reader'
import { closeReader } from './pump'

/** The key of the surface module the pane draws beside the buttons: the plugin knows its posts by it. */
export const ORG_KEYS_KEY = 'org-keys'

/** What `$.state` holds before the feed reports anything: the tab is closed, so nothing is running. */
export const ORG_STATUS_IDLE: RineOrgStatus = { phase: 'idle', reason: null, loaded: 0, gaps: 0 }
/** The redraw counter's next value. */
export const nextOrgRev = (rev: number | undefined): number => (rev ?? 0) + 1
const ACK_STATUS: RineOrgStatus = { ...ORG_STATUS_IDLE, phase: 'ack' }

/** What the tab reaches beyond `$.state`. Message text lives in `store()` only: module memory, never state or props of another surface. */
export type OrgTabEnv = {
  store: () => OrgStore
  /** The feed's own words for its last stop or pause; module memory. */
  sentence: () => string | null
  ack: OrgAckStore
  feed: OrgFeed
}

/** What the tab does to `$.state` and the screen. The pane builds it over `$`, which never crosses an import. */
export type OrgTabHost = {
  setTab: (tab: RineOrgTab) => Promise<unknown>
  setStatus: (status: RineOrgStatus) => Promise<unknown>
  redraw: () => Promise<unknown>
  warn: (text: string) => void
}

const ACK_LINES = [
  "This tab shows the messages of every agent in your org, read with this machine's org key. Anyone who can see this screen, or a recording of it, can read them too, and so can any other plugin installed in Claude Code: a plugin can read whatever this pane shows.",
  'Press w to show them, or i to go back to the inbox. You see this once on this machine.'
]
const LOADING = "Reading your org's messages…"
const IDLE = "Press r to read your org's messages."
const EMPTY = 'No messages yet. New messages appear here as your agents send and receive them.'
const TOO_OLD = `This tab needs rine CLI ${RINE_CLI_TESTED_FLOOR} or later.`
const STOPPED = 'The org view stopped.'
const UNSAVED = 'rine: could not save your acknowledgement, so the org view stays closed'

const PHASES: Record<Exclude<RineOrgPhase, 'ack'>, { glyph: string; word: string }> = {
  idle: { glyph: '○', word: 'idle' },
  starting: { glyph: '◌', word: 'starting' },
  live: { glyph: '●', word: 'live' },
  paused: { glyph: '◌', word: 'paused' },
  stopped: { glyph: '✕', word: 'stopped' }
}

/** What the drawing knows beyond the status: the clock and motion, and whether the keys are armed on this pane. */
export type OrgLook = Look & { isFocused: boolean }

/** The sentence under the header: the feed's own words, or the plugin's for a state it owns. */
function noticeOf(status: RineOrgStatus, org: OrgTabEnv, total: number): string | null {
  if (status.phase === 'stopped') return status.reason === 'cli_too_old' ? TOO_OLD : (org.sentence() ?? STOPPED)
  if (status.phase === 'paused') return org.sentence()
  if (total > 0) return null
  if (status.phase === 'live') return EMPTY
  return status.phase === 'idle' ? IDLE : LOADING
}

/** The `w` button of the inbox: asks for the one-time acknowledgement first, and starts the feed only once it is kept. */
export async function openOrgTab(org: OrgTabEnv, host: OrgTabHost): Promise<void> {
  const isKnown = await isOrgAcknowledged(org.ack).catch(() => false)
  if (!isKnown) await host.setStatus(ACK_STATUS)
  await host.setTab('org')
  if (isKnown) org.feed.start()
}

/** Ends the feed and returns to the inbox: the `i` button and the `i` key. */
export async function leaveOrg(org: OrgTabEnv, host: OrgTabHost): Promise<void> {
  org.feed.stop()
  closeReader()
  await host.setTab('inbox')
}

/** Reads again from the newest page: the `r` button and the `R` key. */
export function rereadOrg(org: OrgTabEnv): void {
  org.feed.stop()
  org.feed.start()
}

/** The keys that apply right now, in the dim style of Claude Code's own hints. */
function hintsOf(hasRows: boolean, isViewing: boolean, hasFindings: boolean): string {
  const parts = [hasRows && 'j/k move', hasRows && (isViewing ? 'v close' : 'v view'), hasFindings && 'f findings', 'r re-read', 'i inbox']
  return parts.filter((part): part is string => part !== false).join(' · ')
}

/** The drawing of the org tab: letter buttons always, and beside them `keys`, the surface module the pane draws to take the vi keys after a click. */
export function orgTab(ui: Ui, columns: number, status: RineOrgStatus, org: OrgTabEnv, host: OrgTabHost, keys: RenderNode | null, look: OrgLook) {
  const { Box, Text, Button } = ui
  const inbox = <Button key="inbox" label="Inbox" hotkey="i" onPress={() => leaveOrg(org, host)} />

  if (status.phase === 'ack') {
    const confirm = async (): Promise<void> => {
      try {
        await acknowledgeOrg(org.ack)
      } catch {
        host.warn(UNSAVED)
        return
      }
      org.feed.start()
    }
    return (
      <Box flexDirection="column">
        {ACK_LINES.map((text, at) => <Text key={`ack-${at}`}>{text}</Text>)}
        <Box key="actions" flexDirection="row" flexWrap="wrap">
          <Button key="show" label="Show" hotkey="w" variant="primary" onPress={confirm} />
          {inbox}
        </Box>
      </Box>
    )
  }

  const store = org.store()
  const win = windowOf(store)
  const notice = noticeOf(status, org, win.total)
  const older = store.olderCursor
  /** A button presses the keys of the same move, so a click and a key can never part ways. */
  const go = (keys: () => string[]) => async (): Promise<void> => {
    const effects = stepOrgKeys(store, keys().map((key): KeyEvent => ({ key })))
    await host.redraw()
    if (effects.includes('older') && store.olderCursor !== null) await org.feed.loadOlder(store.olderCursor)
  }
  const { detail } = win
  if (detail === null) closeReader()
  const { vi, findings } = store
  const { bar, lines } = findingsView(store, columns, vi.isFindingsOpen)
  const chips = `${vi.direction === 'all' ? '' : ` · ${vi.direction}`}${vi.query === '' ? '' : ` · /${vi.query}`}${vi.focus === 'reader' && detail !== null ? ' · reader' : ''}`
  const phase = PHASES[status.phase]
  const isReading = notice === LOADING
  return (
    <Box flexDirection="column">
      {headerRow(ui, 'head', {
        left: [{ text: '◆ ', tone: 'brand' }, { text: `whole org${store.org === null ? '' : ` · ${store.org.name}`}`, isBold: true }],
        right: [{ text: ` ${phase.word} · ${status.loaded} loaded · ${status.gaps} gaps${chips}`, tone: 'dim' }],
        lead: pulseGlyph(ui, 'pulse', phase.glyph, look),
        columns: columns - CLOSE_CELLS
      })}
      {bar.map((text, at) => <Text key={`findings-bar-${at}`}>{text}</Text>)}
      {keys}
      {vi.typing !== null && <Text>{safeLine(`/${vi.typing}▏`, columns)}</Text>}
      {vi.isHelpOpen && ORG_KEYS_HELP.map((text, at) => <Text key={`help-${at}`}>{safeLine(text, columns)}</Text>)}
      {isReading && (
        <Box key="reading" flexDirection="row">
          {spinnerGlyph(ui, 'spinner', look)}
          {runsLine(ui, 'reading-text', [{ text: ` ${LOADING}`, tone: 'dim' }], columns - 1)}
        </Box>
      )}
      {!isReading && notice !== null && <Text>{safeLine(notice, columns)}</Text>}
      {win.notices.map((text, at) => <Text key={`note-${at}`} dimColor>{safeLine(text, columns)}</Text>)}
      {!vi.isHelpOpen && orgRows(ui, win.rows, win.selectedId, columns, look)}
      {vi.isFindingsOpen && (
        <Box key="findings" flexDirection="column">
          {lines.map((text, at) => <Text key={`finding-${at}`}>{text}</Text>)}
          {findings.length >= FINDINGS_LIMIT && <Text dimColor>{FINDINGS_TRIMMED}</Text>}
        </Box>
      )}
      {!vi.isHelpOpen && !vi.isFindingsOpen && detail !== null && readerTree(ui, detail, columns, look)}
      <Box key="actions" flexDirection="row" flexWrap="wrap">
        {win.total > 0 && <Button key="next" label="Next" hotkey="j" onPress={go(() => ['j'])} />}
        {win.total > 0 && <Button key="previous" label="Previous" hotkey="k" onPress={go(() => ['k'])} />}
        {win.total > 0 && <Button key="top" label="Top" hotkey="t" onPress={go(() => ['g', 'g'])} />}
        {win.total > 0 && <Button key="bottom" label="Bottom" hotkey="b" onPress={go(() => ['G'])} />}
        {win.total > 0 && <Button key="view" label={store.view.isReaderOpen ? 'Close' : 'View'} hotkey="v" onPress={go(() => [store.view.isReaderOpen ? 'q' : 'return'])} />}
        {findings.length > 0 && <Button key="findings" label="Findings" hotkey="f" onPress={go(() => ['f'])} />}
        {older !== null && <Button key="older" label="Older" hotkey="p" onPress={() => org.feed.loadOlder(older)} />}
        <Button key="reread" label="Re-read" hotkey="r" onPress={() => rereadOrg(org)} />
        {inbox}
      </Box>
      {look.isFocused && hintLine(ui, 'hints', hintsOf(win.total > 0, store.view.isReaderOpen, findings.length > 0), columns)}
    </Box>
  )
}
