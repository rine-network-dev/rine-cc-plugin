import type { EngineInterface, Register } from 'claude-code'
import { read, update } from 'claude-code'
import type { RineEntry, RineLists, RinePreview } from '../../types/index'
import { safeLine } from '../lib/sanitize'
import { DEFAULT_PREFS, isMuted } from '../lib/prefs'
import type { ListName } from '../lib/lists'
import { createActions, GROUP_WARNING, INBOX_PANE, listEntryOf, type UiEnv } from './pane-actions'
import { detailTree, headerLine, listLines, registerReply } from './pane-detail'
import { sectionsOf, sectionTree, snippetOf } from './pane-rows'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const prefsRef = { plugin: 'rine', key: 'prefs' } as const
const streamRef = { plugin: 'rine', key: 'stream' } as const
const identityRef = { plugin: 'rine', key: 'identity' } as const
const listsRef = { plugin: 'rine', key: 'lists' } as const
const trustedRef = { plugin: 'rine', key: 'isListsTrusted' } as const
const ownerRef = { plugin: 'rine', key: 'isOwner' } as const
const legacyRef = { plugin: 'rine', key: 'isLegacyPaused' } as const
const warnRef = { plugin: 'rine', key: 'groupWarnId' } as const
const focusRef = { plugin: 'rine', key: 'focusId' } as const
const selectedRef = { plugin: 'rine', key: 'isSelected' } as const
const previewRef = { plugin: 'rine', key: 'preview' } as const

/** Shown while the pane lacks the keyboard: a pane letter then goes to the composer or to the band. */
const KEYS_HINT = 'click here or ctrl+x tab to use the keys'

async function selectedOf($: EngineInterface, entries: readonly RineEntry[]): Promise<string[]> {
  const ids: string[] = []
  for (const entry of entries) if ((await read($, { ...selectedRef, id: entry.id })) === true) ids.push(entry.id)
  return ids
}

/** Actions apply to the selected entries, or to the focused one when nothing is selected. */
async function targetsOf($: EngineInterface): Promise<RineEntry[]> {
  const entries = (await read($, entriesRef)) ?? []
  const ids = await selectedOf($, entries)
  const focus = await read($, focusRef)
  return entries.filter((entry) => (ids.length > 0 ? ids.includes(entry.id) : entry.id === focus))
}

async function deselect($: EngineInterface, ids: readonly string[]): Promise<void> {
  for (const id of ids) await update($, { ...selectedRef, id }, () => false)
}

export const registerPane = (on: Parameters<Register>[0], env: UiEnv): void => {
  const actions = createActions(env)
  registerReply(on)

  on('ui.render', { component: 'Pane', requestId: 'rine-inbox' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const entries = (await read($, entriesRef)) ?? []
    const prefs = (await read($, prefsRef)) ?? DEFAULT_PREFS
    const stream = await read($, streamRef)
    const identity = await read($, identityRef)
    if (stream === undefined || identity === undefined) return <Text dimColor>rine is starting…</Text>
    const isTrusted = (await read($, trustedRef)) !== false
    const lists: RineLists = (await read($, listsRef)) ?? { allow: [], deny: [] }
    const isOwner = (await read($, ownerRef)) !== false
    const isLegacyPaused = (await read($, legacyRef)) === true
    /** The entry whose `[g Allow]` is awaiting its second press; the warning shows meanwhile. */
    const pendingGroup = (await read($, warnRef)) ?? null
    const focus = (await read($, focusRef)) ?? null
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    const selected = new Set(await selectedOf($, entries))
    const sections = sectionsOf(entries, now)
    const previews = new Map<string, RinePreview | undefined>()
    for (const entry of [...sections.held, ...(focus === null ? [] : entries.filter((one) => one.id === focus))]) {
      previews.set(entry.id, await read($, { ...previewRef, id: entry.id }))
    }
    const snippets = new Map(sections.held.map((entry) => [entry.id, snippetOf(previews.get(entry.id))] as const))
    const current = entries.find((entry) => entry.id === focus)
    const warned = current !== undefined && pendingGroup === current.id
    const say = (text: string | null): void => {
      if (text !== null) $.ui.toast(`rine: ${text}`)
    }
    const press = (job: (targets: RineEntry[]) => Promise<string | null>) => async (): Promise<void> => {
      const targets = await targetsOf($)
      say(await job(targets))
    }
    const onToggle = async (id: string): Promise<void> => {
      await update($, { ...selectedRef, id }, (isOn) => isOn !== true)
      await update($, focusRef, () => id)
    }
    const decide = (name: ListName, kind: 'agent' | 'group') => press(async ([target]) => {
      const entry = target === undefined ? null : listEntryOf(target, kind)
      return entry === null ? 'that sender cannot be listed' : actions.addTo(name, entry)
    })
    const askGroup = press(async ([target]) => {
      const entry = target === undefined ? null : listEntryOf(target, 'group')
      if (entry === null || target === undefined) return 'that group cannot be listed'
      if (pendingGroup !== target.id) {
        await update($, warnRef, () => target.id)
        await $.ui.invalidate('ui.render')
        return null
      }
      await update($, warnRef, () => null)
      return actions.addTo('allow', entry)
    })
    const readAll = press(async (targets) => {
      for (const target of targets) await actions.read(target.id)
      return null
    })
    const finish = (job: (ids: string[]) => Promise<string | null>) => press(async (targets) => {
      const ids = targets.map((target) => target.id)
      const text = await job(ids)
      await deselect($, ids)
      return text
    })
    const handOver = finish(actions.hand)
    const markAll = finish(actions.markRead)
    const cancel = async (): Promise<void> => {
      await update($, warnRef, () => null)
      await $.ui.invalidate('ui.render')
    }
    const spec = { now, columns, selected, snippets, onToggle }
    const phase = stream.phase
    const isQuiet = isMuted(prefs, now, isLegacyPaused)
    const isGroup = current?.group != null
    const reply = press(async ([target]) => {
      if (target === undefined || target.group !== null) return 'reply works on one-to-one messages'
      await update($, focusRef, () => target.id)
      await $.ui.close({ id: INBOX_PANE.id })
      const opened = await $.ui.open({ id: 'rine-reply', title: `Reply to ${safeLine(target.from, 40)}`, focus: true, closeOnEscape: true })
      if (opened.isPlaced) return null
      await $.ui.open(INBOX_PANE)
      return 'the reply pane did not open'
    })

    return (
      <Box flexDirection="column">
        <Text>{headerLine({ identity, phase, isPreview: prefs.isPreview, isMuted: isQuiet, isOwner }, columns)}</Text>
        {!e.props.isFocused && <Text dimColor>{KEYS_HINT}</Text>}
        {!isTrusted && !warned && (
          <Box key="untrusted" flexDirection="row">
            <Text>Lists changed outside /rine — review </Text>
            <Button key="confirm" label="Confirm" hotkey="c" onPress={press(async () => actions.confirm())} />
          </Box>
        )}
        {!isTrusted && !warned && listLines(lists, columns).map((text, at) => <Text key={`list-${at}`}>{text}</Text>)}
        {sectionTree(ui, { ...spec, key: 'held', title: 'Held for review', entries: sections.held, isDim: false })}
        {sectionTree(ui, { ...spec, key: 'unread', title: 'Unread', entries: sections.unread, isDim: false })}
        {sectionTree(ui, { ...spec, key: 'earlier', title: 'Earlier, last 24h', entries: sections.earlier, isDim: false })}
        {sectionTree(ui, { ...spec, key: 'filtered', title: 'Filtered', entries: sections.filtered, isDim: true })}
        {current !== undefined && detailTree(ui, previews.get(current.id), columns)}
        {warned && current?.group != null && <Text>{safeLine(GROUP_WARNING(current.group), columns)}</Text>}
        <Box key="actions" flexDirection="row" flexWrap="wrap">
          <Button key="read" label="Read" hotkey="r" onPress={readAll} />
          <Button key="hand" label="Hand to Claude" hotkey="s" variant="primary" onPress={handOver} />
          <Button key="mark" label="Mark read" hotkey="e" onPress={markAll} />
          {current !== undefined && !isGroup && <Button key="reply" label="Reply" hotkey="y" onPress={reply} />}
          {current !== undefined && !isGroup && <Button key="allow" label="Allow sender" hotkey="a" onPress={decide('allow', 'agent')} />}
          {current !== undefined && !isGroup && <Button key="deny" label="Deny sender" hotkey="d" onPress={decide('deny', 'agent')} />}
          {isGroup && <Button key="allow-group" label={warned ? 'Allow' : 'Allow group'} hotkey="g" onPress={askGroup} />}
          {isGroup && !warned && <Button key="deny-group" label="Deny group" hotkey="k" onPress={decide('deny', 'group')} />}
          {warned && <Button key="cancel" label="Cancel" hotkey="c" onPress={cancel} />}
          <Button key="preview" label={prefs.isPreview ? 'Preview off' : 'Preview on'} hotkey="p" onPress={async () => say(await actions.setPreview(!prefs.isPreview, sections.held.length))} />
          <Button key="mute" label={isQuiet ? 'Unmute' : 'Mute'} hotkey="q" onPress={async () => say(isQuiet ? await actions.unmute() : await actions.mute('1h'))} />
          {(phase === 'backoff' || phase === 'offline' || phase === 'auth-failed') && <Button key="reconnect" label="Reconnect" hotkey="x" onPress={async () => say(await actions.reconnect())} />}
          {!isOwner && <Button key="takeover" label="Take over" hotkey="t" onPress={async () => say(await actions.takeover())} />}
        </Box>
      </Box>
    )
  })
}
