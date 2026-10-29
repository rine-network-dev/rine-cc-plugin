import type { EngineInterface, Register } from 'claude-code'
import { read, update } from 'claude-code'
import type { RineEntry, RineLists } from '../../types/index'
import { withText, type PreviewTextOf, type ReadPreview } from '../lib/preview'
import { fittedHandle, ownSlugOf } from '../lib/shown-handle'
import { DEFAULT_PREFS, isMuted } from '../lib/prefs'
import type { ListName } from '../lib/lists'
import { lookOf } from './look'
import { applyOrgKeys } from './org-keys-input'
import { ORG_KEYS_KEY, ORG_STATUS_IDLE, nextOrgRev, openOrgTab, orgTab, type OrgTabEnv, type OrgTabHost } from './org-tab'
import { createActions, INBOX_PANE, listEntryOf, type UiEnv } from './pane-actions'
import { keysHint } from './pane-hints'
import { inboxTree } from './pane-inbox'
import { registerReply } from './pane-reply'
import { sectionsOf, snippetOf } from './pane-rows'

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
const orgTabRef = { plugin: 'rine', key: 'orgTab' } as const
const orgStatusRef = { plugin: 'rine', key: 'orgStatus' } as const
/** The org feed bumps this when module memory changes; reading it makes the drawing follow. */
const orgRevRef = { plugin: 'rine', key: 'orgRev' } as const

/** The org tab's hands on `$.state` and the screen. */
const orgHostOf = ($: EngineInterface): OrgTabHost => ({
  setTab: (tab) => update($, orgTabRef, () => tab),
  setStatus: (status) => update($, orgStatusRef, () => status),
  redraw: () => update($, orgRevRef, nextOrgRev),
  warn: (text) => $.ui.toast(text)
})

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

export const registerPane = (on: Parameters<Register>[0], env: UiEnv, org: OrgTabEnv, textOf: PreviewTextOf): void => {
  const actions = createActions(env)
  registerReply(on)

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== INBOX_PANE.id || e.element !== ORG_KEYS_KEY) return next(e)
    const status = (await read($, orgStatusRef)) ?? ORG_STATUS_IDLE
    if ((await read($, orgTabRef)) === 'org' && status.phase !== 'ack') await applyOrgKeys(org, orgHostOf($), e.data)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'rine-inbox' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Client } = ui
    const host = orgHostOf($)
    const prefs = (await read($, prefsRef)) ?? DEFAULT_PREFS
    const look = await lookOf({ now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn), redraw: () => $.ui.invalidate('ui.render') }, e.surface, prefs)
    const columns = e.props.bodyColumns
    if ((await read($, orgTabRef)) === 'org') {
      await read($, orgRevRef)
      const status = (await read($, orgStatusRef)) ?? ORG_STATUS_IDLE
      return (
        <Box flexDirection="column">
          {keysHint(ui, e.props.isFocused, columns)}
          {orgTab(ui, columns, status, org, host, <Client key={ORG_KEYS_KEY} module="./org-view.tsx" height={1} />, { ...look, isFocused: e.props.isFocused })}
        </Box>
      )
    }
    const entries = (await read($, entriesRef)) ?? []
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
    const selected = new Set(await selectedOf($, entries))
    const sections = sectionsOf(entries, look.now)
    const current = entries.find((entry) => entry.id === focus)
    const previews = new Map<string, ReadPreview | undefined>()
    const snippets = new Map<string, string>()
    for (const entry of [...sections.held, ...(current === undefined ? [] : [current])]) {
      const preview = withText(await read($, { ...previewRef, id: entry.id }), textOf(entry.id))
      previews.set(entry.id, preview)
      if (entry.disposition === 'held' || preview !== undefined) snippets.set(entry.id, snippetOf(preview))
    }
    const isWarned = current !== undefined && pendingGroup === current.id
    const say = (text: string | null): void => {
      if (text !== null) $.ui.toast(`rine: ${text}`)
    }
    const press = (job: (targets: RineEntry[]) => Promise<string | null>) => async (): Promise<void> => {
      const targets = await targetsOf($)
      say(await job(targets))
    }
    const decide = (name: ListName, kind: 'agent' | 'group') => press(async ([target]) => {
      const entry = target === undefined ? null : listEntryOf(target, kind)
      return entry === null ? 'that sender cannot be listed' : actions.addTo(name, entry)
    })
    const finish = (job: (ids: string[]) => Promise<string | null>) => press(async (targets) => {
      const ids = targets.map((target) => target.id)
      const text = await job(ids)
      await deselect($, ids)
      return text
    })
    const isQuiet = isMuted(prefs, look.now, isLegacyPaused)

    return inboxTree(ui, {
      columns,
      look,
      isFocused: e.props.isFocused,
      header: { identity, phase: stream.phase, isPreview: prefs.isPreview, isMuted: isQuiet, isOwner },
      identity,
      ownSlug: ownSlugOf(identity.handle),
      lists,
      sections,
      selected,
      snippets,
      current,
      preview: current === undefined ? undefined : previews.get(current.id),
      onToggle: async (id) => {
        await update($, { ...selectedRef, id }, (isOn) => isOn !== true)
        await update($, focusRef, () => id)
      },
      buttons: {
        hasFocus: current !== undefined,
        isGroup: current?.group != null,
        isWarned,
        isTrusted,
        isPreview: prefs.isPreview,
        isQuiet,
        isOwner,
        phase: stream.phase,
        jobs: {
          read: press(async (targets) => {
            for (const target of targets) await actions.read(target.id)
            return null
          }),
          hand: finish(actions.hand),
          mark: finish(actions.markRead),
          reply: press(async ([target]) => {
            if (target === undefined || target.group !== null) return 'reply works on one-to-one messages'
            await update($, focusRef, () => target.id)
            await $.ui.close({ id: INBOX_PANE.id })
            const opened = await $.ui.open({ id: 'rine-reply', title: `Reply to ${fittedHandle(target.from, 40)}`, focus: true, closeOnEscape: true })
            if (opened.isPlaced) return null
            await $.ui.open(INBOX_PANE)
            return 'the reply pane did not open'
          }),
          confirm: press(async () => actions.confirm()),
          allowSender: decide('allow', 'agent'),
          denySender: decide('deny', 'agent'),
          allowGroup: press(async ([target]) => {
            const entry = target === undefined ? null : listEntryOf(target, 'group')
            if (entry === null || target === undefined) return 'that group cannot be listed'
            if (pendingGroup !== target.id) {
              await update($, warnRef, () => target.id)
              await $.ui.invalidate('ui.render')
              return null
            }
            await update($, warnRef, () => null)
            return actions.addTo('allow', entry)
          }),
          denyGroup: decide('deny', 'group'),
          cancel: async () => {
            await update($, warnRef, () => null)
            await $.ui.invalidate('ui.render')
          },
          preview: async () => say(await actions.setPreview(!prefs.isPreview, sections.held.length)),
          mute: async () => say(isQuiet ? await actions.unmute() : await actions.mute('1h')),
          reconnect: async () => say(await actions.reconnect()),
          takeover: async () => say(await actions.takeover()),
          org: () => openOrgTab(org, host)
        }
      }
    })
  })
}
