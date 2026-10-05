import type { EngineInterface, Register } from 'claude-code'
import { read } from 'claude-code'
import type { RineEntry, RinePreview } from '../../types/index'
import { isMuted } from '../lib/prefs'
import { shortType } from '../lib/model-text'
import { displayWidth, safeLine } from '../lib/sanitize'
import { createActions, INBOX_PANE, placementNote, type UiEnv } from './pane-actions'
import { snippetOf } from './pane-rows'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const prefsRef = { plugin: 'rine', key: 'prefs' } as const
const legacyRef = { plugin: 'rine', key: 'isLegacyPaused' } as const
const previewRef = { plugin: 'rine', key: 'preview' } as const

const NAMES = 3
const PREVIEW_ROWS = 3
const HINT = 'ctrl+x tab'
const BUTTON_CHROME = 5

/** What the band lists: unread entries, held ones included, never the filtered. */
function listedOf(entries: readonly RineEntry[] | undefined): RineEntry[] {
  return (entries ?? []).filter((entry) => entry.state === 'unread' && entry.list !== 'deny')
}

async function listedIds($: EngineInterface): Promise<string[]> {
  return listedOf(await read($, entriesRef)).map((entry) => entry.id)
}

export function nameOf(entry: RineEntry): string {
  return `${safeLine(entry.group ?? entry.from, 32)} (${shortType(entry.type)})`
}

export function headline(listed: readonly RineEntry[]): string {
  const names = listed.slice(0, NAMES).map(nameOf).join(', ')
  const more = listed.length > NAMES ? `, +${listed.length - NAMES}` : ''
  return `rine: ${listed.length} new — ${names}${more}`
}

type Layout = { previews: number; isInline: boolean }

/** Preview rows go first, then the headline joins the buttons' row: every Button stays inside `maxRows`. */
export function layoutOf(maxRows: number, columns: number, buttonCells: number, wanted: number): Layout {
  const buttonRows = Math.max(1, Math.ceil(buttonCells / Math.max(columns, 1)))
  return {
    previews: Math.max(0, Math.min(wanted, maxRows - 1 - buttonRows)),
    isInline: maxRows <= buttonRows
  }
}

export const registerBand = (on: Parameters<Register>[0], env: UiEnv): void => {
  const actions = createActions(env)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const entries = await read($, entriesRef)
    const prefs = await read($, prefsRef)
    const isLegacyPaused = (await read($, legacyRef)) === true
    const listed = listedOf(entries)
    if (e.props.hasSurvey || prefs === undefined || listed.length === 0 || isMuted(prefs, await $.clock.now(), isLegacyPaused)) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const say = (text: string | null): void => {
      if (text !== null) $.ui.toast(`rine: ${text}`)
    }
    const columns = e.props.bodyColumns
    const isPreview = prefs.isPreview
    const openLabel = isPreview ? 'Review' : 'Open'
    const handLabel = `Hand to Claude (${listed.length})`
    const labels = [openLabel, ...(isPreview ? [] : [handLabel]), 'Mark read', 'Mute 1h']
    const cells = labels.reduce((sum, label) => sum + displayWidth(label) + BUTTON_CHROME, 0)
    const layout = layoutOf(e.props.maxRows, columns, cells, isPreview ? PREVIEW_ROWS : 0)
    const shown = listed.slice(0, layout.previews)
    const previews: (RinePreview | undefined)[] = []
    for (const entry of shown) previews.push(await read($, { ...previewRef, id: entry.id }))
    const head = safeLine(layout.isInline ? `rine: ${listed.length} new` : headline(listed), Math.max(columns - HINT.length - 1, 8))

    return (
      <Box flexDirection="column">
        {!layout.isInline && (
          <Box key="head" flexDirection="row">
            <Text>{head}</Text>
            <Text dimColor>{` ${HINT}`}</Text>
          </Box>
        )}
        {shown.map((entry, index) => (
          <Text>{safeLine(`${safeLine(entry.from, 32)}: ${snippetOf(previews[index])}`, columns)}</Text>
        ))}
        <Box key="buttons" flexDirection="row" flexWrap="wrap">
          {layout.isInline && <Text>{head}</Text>}
          <Button
            key="open"
            label={openLabel}
            hotkey="o"
            onPress={async () => say(placementNote(await $.ui.open(INBOX_PANE)))}
          />
          {!isPreview && (
            <Button
              key="hand"
              label={handLabel}
              hotkey="h"
              variant="primary"
              onPress={async () => say(await actions.hand(await listedIds($)))}
            />
          )}
          <Button key="read" label="Mark read" hotkey="m" onPress={async () => say(await actions.markRead(await listedIds($)))} />
          <Button key="mute" label="Mute 1h" hotkey="u" onPress={async () => say(await actions.mute('1h'))} />
        </Box>
      </Box>
    )
  })
}
