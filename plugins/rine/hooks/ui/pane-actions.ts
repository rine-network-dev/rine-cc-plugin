import type { RineEntry, RineListEntry, RineLists, RinePrefs } from '../../types/index'
import type { HandOffResult } from '../lib/delivery-wake'
import { addEntry, parseHandle, removeEntry, type ListName } from '../lib/lists'
import { safeLine } from '../lib/sanitize'
import { muteDeadline, withMotion, withMute, withPreview, type MuteSpec } from '../lib/prefs'

/** `untrusted`: saved, but the lists changed outside /rine, so only Confirm lets an allow entry wake Claude. */
export type Edited = 'ok' | 'unchanged' | 'failed' | 'untrusted'

/** What the band, the pane and /rine reach beyond `$.state`; `register.tsx` binds each member over the real ports. */
export type UiEnv = {
  now: () => Promise<number>
  handOff: (ids: readonly string[]) => Promise<HandOffResult>
  markRead: (ids: readonly string[]) => Promise<void>
  loadPreview: (id: string) => Promise<void>
  editPrefs: (edit: (prefs: RinePrefs) => RinePrefs | undefined) => Promise<Edited>
  editLists: (edit: (lists: RineLists) => RineLists | undefined) => Promise<Edited>
  confirmLists: () => Promise<boolean>
  hasLegacyPause: () => Promise<boolean>
  reconnect: () => Promise<void>
  takeover: () => Promise<boolean>
}

/** Every action answers the line to show the person, or null when nothing needs saying. */
export type Actions = {
  hand: (ids: readonly string[]) => Promise<string | null>
  markRead: (ids: readonly string[]) => Promise<string | null>
  read: (id: string) => Promise<string | null>
  mute: (spec: MuteSpec) => Promise<string>
  unmute: () => Promise<string>
  setPreview: (isOn: boolean, held: number) => Promise<string>
  setMotion: (isOn: boolean) => Promise<string>
  addTo: (name: ListName, entry: RineListEntry) => Promise<string>
  removeFrom: (name: ListName, entry: RineListEntry) => Promise<string>
  confirm: () => Promise<string>
  reconnect: () => Promise<string>
  takeover: () => Promise<string>
}

export const INBOX_PANE = { id: 'rine-inbox', title: 'rine', focus: true } as const

/** A pane that could not be placed says why; the reason is the engine's own text, so it is scrubbed. */
export function placementNote(result: { isPlaced: boolean; reason?: string }): string | null {
  return result.isPlaced ? null : `the inbox pane did not open: ${safeLine(result.reason ?? 'no room', 60)}`
}

/** The list entry a pane press means: the entry's sender, or its group, pinned to the id the entry carries. */
export function listEntryOf(entry: RineEntry, kind: RineListEntry['kind']): RineListEntry | null {
  const parsed = parseHandle(kind === 'group' ? (entry.group ?? '') : entry.from)
  if (parsed === null || parsed.kind !== kind) return null
  return { ...parsed, agentId: kind === 'group' ? entry.groupId : entry.fromAgentId }
}

export const GROUP_WARNING = (handle: string): string =>
  `Any member of ${handle}, including anyone who joins later, can start a turn.`

const UNSAVED = 'could not save: the state folder is read-only'
const UNCONFIRMED = ' The lists changed outside /rine: press Confirm in the inbox pane before an allow entry can wake Claude.'
const MUTE_TEXT: Record<MuteSpec, string> = {
  '1h': 'muted for 1h',
  '8h': 'muted for 8h',
  'off-hours': 'muted until 08:00',
  forever: 'muted until you unmute'
}

export function createActions(env: UiEnv): Actions {
  const saved = (edited: Edited, text: string): string =>
    edited === 'failed' ? UNSAVED : edited === 'untrusted' ? `${text}${UNCONFIRMED}` : text
  const reach = (isOk: boolean, text: string): string => (isOk ? text : 'it did not go through; try again')

  return {
    async hand(ids) {
      if (ids.length === 0) return 'nothing selected'
      const result = await env.handOff(ids)
      return result.status === 'empty' ? 'nothing to hand to Claude' : null
    },
    async markRead(ids) {
      if (ids.length === 0) return 'nothing selected'
      await env.markRead(ids)
      return null
    },
    async read(id) {
      await env.loadPreview(id)
      return null
    },
    async mute(spec) {
      const until = muteDeadline(spec, await env.now())
      return saved(await env.editPrefs((prefs) => withMute(prefs, until)), MUTE_TEXT[spec])
    },
    async unmute() {
      const legacy = await env.hasLegacyPause()
      const text = legacy ? 'unmuted; the old monitor-pause file is now ignored (you can delete it)' : 'unmuted'
      return saved(await env.editPrefs((prefs) => withMute(prefs, null)), text)
    },
    async setPreview(isOn, held) {
      const text = isOn
        ? 'preview on: new messages wait for your review'
        : `preview off${held > 0 ? `: ${held} held stay held, /rine to hand them over` : ''}`
      return saved(await env.editPrefs((prefs) => withPreview(prefs, isOn)), text)
    },
    async setMotion(isOn) {
      return saved(await env.editPrefs((prefs) => withMotion(prefs, isOn)), isOn ? 'motion on' : 'motion off: the terminal stays still')
    },
    async addTo(name, entry) {
      let isFull = false
      const edited = await env.editLists((lists) => {
        const next = addEntry(lists, name, entry)
        isFull = next === undefined
        return next
      })
      if (isFull) return `the ${name} list is full`
      const warning = name === 'allow' && entry.kind === 'group' ? ` ${GROUP_WARNING(entry.handle)}` : ''
      return saved(edited, `${entry.handle} is on the ${name} list.${warning}`)
    },
    async removeFrom(name, entry) {
      const edited = await env.editLists((lists) => {
        const next = removeEntry(lists, name, entry)
        return next[name].length === lists[name].length ? undefined : next
      })
      return saved(edited, edited === 'unchanged' ? `${entry.handle} was not on the ${name} list` : `${entry.handle} left the ${name} list`)
    },
    async confirm() {
      return reach(await env.confirmLists(), 'lists confirmed')
    },
    async reconnect() {
      await env.reconnect()
      return 'reconnecting'
    },
    async takeover() {
      return reach(await env.takeover(), 'this session now owns the inbox')
    }
  }
}
