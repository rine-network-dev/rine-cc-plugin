import type { EngineInterface, Register } from 'claude-code'
import { read, update } from 'claude-code'
import type { RineEntry } from '../../types/index'
import { isMuted } from '../lib/prefs'
import { REVEAL_MS, reveal, type Look } from '../lib/motion'
import { shortType } from '../lib/model-text'
import { withText, type PreviewTextOf, type ReadPreview } from '../lib/preview'
import { displayWidth, safeLine } from '../lib/sanitize'
import { ownSlugOf, shownHandle } from '../lib/shown-handle'
import { clipRuns, runsLine, type Run } from './chrome'
import { lookOf } from './look'
import { createActions, INBOX_PANE, placementNote, type UiEnv } from './pane-actions'
import { snippetOf } from './pane-rows'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const prefsRef = { plugin: 'rine', key: 'prefs' } as const
const identityRef = { plugin: 'rine', key: 'identity' } as const
const previewRef = { plugin: 'rine', key: 'preview' } as const
const legacyRef = { plugin: 'rine', key: 'isLegacyPaused' } as const
const foldedRef = { plugin: 'rine', key: 'foldedIds' } as const

const NAMES = 3
const PREVIEW_ROWS = 3
const HINT = ' ctrl+x tab'
const BUTTON_CHROME = 5
const NAME_CELLS = 32

/** What the band lists: unread entries, held ones included, never the filtered. */
const listedOf = (entries: readonly RineEntry[] | undefined): RineEntry[] =>
  (entries ?? []).filter((entry) => entry.state === 'unread' && entry.list !== 'deny')

const tailText = (count: number): string => `◆ rine ${count} new — /rine to open`

/** Folds every listed entry: the band stops drawing for them and the line under the prompt carries them. */
async function foldListed($: EngineInterface): Promise<void> {
  const ids = listedOf(await read($, entriesRef)).map((entry) => entry.id)
  await update($, foldedRef, () => ids)
}

/** The listed entries split by the fold atom: `fresh` the band draws, `folded` the line under the prompt counts; `isQuiet` silences both. */
async function announcedOf($: EngineInterface) {
  const listed = listedOf(await read($, entriesRef))
  const folded = new Set((await read($, foldedRef)) ?? [])
  const prefs = await read($, prefsRef)
  const isLegacyPaused = (await read($, legacyRef)) === true
  const isQuiet = prefs === undefined || isMuted(prefs, await $.clock.now(), isLegacyPaused)
  return { listed, prefs, fresh: listed.filter((entry) => !folded.has(entry.id)), folded: listed.filter((entry) => folded.has(entry.id)), isQuiet }
}

const nameOf = (entry: RineEntry, ownSlug: string | null, cells: number): string =>
  `${shownHandle(entry.group ?? entry.from, ownSlug, cells)} (${shortType(entry.type)})`

const moreOf = (count: number): string => (count > 0 ? `, +${count}` : '')

/**
 * The first arrivals' names within `budget` cells, the rest counted into `+N`. A name joins only whole (with the `+N` it
 * leaves behind); the first is fitted to the budget instead, so the head never cuts inside a name.
 */
function namesOf(listed: readonly RineEntry[], ownSlug: string | null, budget: number): string {
  const names: string[] = []
  for (const entry of listed.slice(0, NAMES)) {
    const left = listed.length - names.length - 1
    const cells = names.length === 0 ? Math.max(1, Math.min(NAME_CELLS, budget - displayWidth(` (${shortType(entry.type)})${moreOf(left)}`))) : NAME_CELLS
    const next = [...names, nameOf(entry, ownSlug, cells)]
    if (names.length > 0 && displayWidth(`${next.join(', ')}${moreOf(left)}`) > budget) break
    names.push(next[next.length - 1] as string)
  }
  return `${names.join(', ')}${moreOf(listed.length - names.length)}`
}

/** The wordmark resolves from shaded blocks while the newest arrival is fresh. */
function wordmarkOf(newest: RineEntry | undefined, look: Look): string {
  if (!look.isMotion || newest === undefined) return 'rine'
  const age = look.now - newest.receivedAt
  if (age < REVEAL_MS) look.wake(newest.receivedAt + REVEAL_MS)
  return reveal('rine', Math.max(0, age))
}

type Layout = { previews: number; isInline: boolean }

/** Preview rows go first, then the headline joins the buttons' row: every Button stays inside `maxRows`. */
function layoutOf(maxRows: number, columns: number, buttonCells: number, wanted: number): Layout {
  const buttonRows = Math.max(1, Math.ceil(buttonCells / Math.max(columns, 1)))
  return {
    previews: Math.max(0, Math.min(wanted, maxRows - 1 - buttonRows)),
    isInline: maxRows <= buttonRows
  }
}

export const registerBand = (on: Parameters<Register>[0], env: UiEnv, textOf: PreviewTextOf): void => {
  const actions = createActions(env)
  /** A submit folds the band into the line under the prompt; the prompt goes on unchanged. */
  on('prompt.submit', async ($, e, next) => {
    await foldListed($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { folded, isQuiet } = await announcedOf($)
    if (isQuiet || folded.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, tail: tailText(folded.length) } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { listed, prefs, fresh, isQuiet } = await announcedOf($)
    if (e.props.hasSurvey || prefs === undefined || fresh.length === 0 || isQuiet) return next(e)
    /** A press folds everything listed at the draw; it acts on, and the band counts, only the arrivals since the last fold. */
    const foldIds = listed.map((entry) => entry.id)
    const ids = fresh.map((entry) => entry.id)
    const ownSlug = ownSlugOf((await read($, identityRef))?.handle ?? null)
    const look = await lookOf({ now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn), redraw: () => $.ui.invalidate('ui.render') }, e.surface, prefs)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const say = (text: string | null): void => {
      if (text !== null) $.ui.toast(`rine: ${text}`)
    }
    /** Any press folds the entries the band showed; one that arrived since the draw stays fresh. */
    const act = (job: () => Promise<string | null>) => async (): Promise<void> => {
      await update($, foldedRef, () => foldIds)
      say(await job())
    }
    const columns = e.props.bodyColumns
    const isPreview = prefs.isPreview
    const openLabel = isPreview ? 'Review' : 'Open'
    const handLabel = `Hand to Claude (${fresh.length})`
    const labels = [openLabel, ...(isPreview ? [] : [handLabel]), 'Mark read', 'Mute 1h', 'Later']
    const cells = labels.reduce((sum, label) => sum + displayWidth(label) + BUTTON_CHROME, 0)
    const layout = layoutOf(e.props.maxRows, columns, cells, isPreview ? PREVIEW_ROWS : 0)
    const shown = fresh.slice(0, layout.previews)
    const previews: (ReadPreview | undefined)[] = []
    for (const entry of shown) previews.push(withText(await read($, { ...previewRef, id: entry.id }), textOf(entry.id)))
    const newest = [...fresh].sort((a, b) => b.receivedAt - a.receivedAt)[0]
    const lead = `◆ rine  ${fresh.length} new — `
    const head: Run[] = [
      { text: '◆ ', tone: 'brand' },
      { text: wordmarkOf(newest, look), tone: 'brand', isBold: true },
      { text: `  ${fresh.length} new${layout.isInline ? '' : ` — ${namesOf(fresh, ownSlug, columns - HINT.length - displayWidth(lead))}`}` }
    ]
    const headRuns = clipRuns(head, Math.max(columns - HINT.length, 8))

    return (
      <Box flexDirection="column">
        {!layout.isInline && runsLine(ui, 'head', [...headRuns, { text: HINT, tone: 'dim' }], columns)}
        {shown.map((entry, index) => (
          <Text key={`preview:${entry.id}`}>{safeLine(`${shownHandle(entry.from, ownSlug, Math.max(1, Math.min(NAME_CELLS, columns - 2)))}: ${snippetOf(previews[index])}`, columns)}</Text>
        ))}
        <Box key="buttons" flexDirection="row" flexWrap="wrap">
          {layout.isInline && runsLine(ui, 'inline', headRuns, columns)}
          <Button key="open" label={openLabel} hotkey="o" onPress={act(async () => placementNote(await $.ui.open(INBOX_PANE)))} />
          {!isPreview && (
            <Button key="hand" label={handLabel} hotkey="h" variant="primary" onPress={act(async () => actions.hand(ids))} />
          )}
          <Button key="read" label="Mark read" hotkey="m" onPress={act(async () => actions.markRead(ids))} />
          <Button key="mute" label="Mute 1h" hotkey="u" onPress={act(() => actions.mute('1h'))} />
          <Button key="later" label="Later" hotkey="l" role="dismiss" dimColor onPress={act(async () => null)} />
        </Box>
      </Box>
    )
  })
}
