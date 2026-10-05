import type { Register } from 'claude-code'
import { read } from 'claude-code'
import type { RineListEntry } from '../../types/index'
import { counts } from '../lib/ledger'
import { parseHandle, type ListName } from '../lib/lists'
import type { MuteSpec } from '../lib/prefs'
import { safeLine } from '../lib/sanitize'
import { createActions, INBOX_PANE, placementNote, type UiEnv } from '../ui/pane-actions'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const listsRef = { plugin: 'rine', key: 'lists' } as const
const trustedRef = { plugin: 'rine', key: 'isListsTrusted' } as const

export const USAGE =
  'usage: /rine [mute [1h|8h|off-hours|forever] | unmute | preview on|off | allow|deny add|remove <handle|#group> | ' +
  'allow|deny list | reconnect | takeover]. Changes run only at your own keyboard, not over Remote Control.'

export type Command =
  | { kind: 'open' }
  | { kind: 'mute'; spec: MuteSpec }
  | { kind: 'unmute' }
  | { kind: 'preview'; isOn: boolean }
  | { kind: 'edit'; name: ListName; op: 'add' | 'remove'; raw: string }
  | { kind: 'show'; name: ListName }
  | { kind: 'reconnect' }
  | { kind: 'takeover' }
  | { kind: 'usage' }

const MUTE_SPECS: readonly MuteSpec[] = ['1h', '8h', 'off-hours', 'forever']
const LIST_NAMES: readonly ListName[] = ['allow', 'deny']

export function parseCommand(args: string): Command {
  const [sub = '', first = '', second = '', ...rest] = args.trim().toLowerCase().split(/\s+/)
  const list = LIST_NAMES.find((name) => name === sub)
  if (sub === '') return { kind: 'open' }
  if (sub === 'mute') {
    const spec = first === '' ? '1h' : MUTE_SPECS.find((one) => one === first)
    return spec === undefined ? { kind: 'usage' } : { kind: 'mute', spec }
  }
  if (sub === 'preview' && (first === 'on' || first === 'off')) return { kind: 'preview', isOn: first === 'on' }
  if (list !== undefined && first === 'list') return { kind: 'show', name: list }
  if (list !== undefined && (first === 'add' || first === 'remove') && second !== '' && rest.length === 0) {
    return { kind: 'edit', name: list, op: first, raw: second }
  }
  if (sub === 'unmute' || sub === 'reconnect' || sub === 'takeover') return { kind: sub }
  return { kind: 'usage' }
}

/** Only the person's own keystroke changes mutes, preview, lists or the lease. */
const MUTATING: ReadonlySet<Command['kind']> = new Set(['mute', 'unmute', 'preview', 'edit', 'takeover'])

export function isMutating(command: Command): boolean {
  return MUTATING.has(command.kind)
}

function listText(name: ListName, entries: readonly RineListEntry[], isTrusted: boolean): string {
  const names = entries.map((entry) => safeLine(entry.handle, 64)).join(', ')
  const note = name === 'allow' && !isTrusted ? ' (changed outside /rine: review in the inbox pane before it wakes Claude)' : ''
  return `${name} list (${entries.length}): ${names === '' ? 'empty' : names}${note}`
}

/** Registered by the one `session.start` hook in `register.tsx`: the validator allows one unmatched hook per event. */
export const RINE_COMMAND = {
  name: 'rine',
  description: 'Open the rine inbox, or mute, preview, allow and deny',
  argumentHint: '[mute|unmute|preview|allow|deny|reconnect|takeover]',
  immediate: true
} as const

export const registerRine = (on: Parameters<Register>[0], env: UiEnv): void => {
  const actions = createActions(env)

  on('command.run', { command: 'rine' }, async ($, e) => {
    const command = parseCommand(e.args)
    if (isMutating(command) && e.origin.kind !== 'composer') {
      return { text: `/rine ${safeLine(e.args.trim().split(/\s+/)[0] ?? '', 20)} is for the user to run at the keyboard.` }
    }
    switch (command.kind) {
      case 'open':
        return { text: placementNote(await $.ui.open(INBOX_PANE)) ?? 'rine inbox opened.' }
      case 'mute':
        return { text: await actions.mute(command.spec) }
      case 'unmute':
        return { text: await actions.unmute() }
      case 'preview':
        return { text: await actions.setPreview(command.isOn, counts((await read($, entriesRef)) ?? []).held) }
      case 'edit': {
        const entry = parseHandle(command.raw)
        if (entry === null) return { text: `${safeLine(command.raw, 40)} is not a handle: use name@org or #group@org.` }
        return { text: await (command.op === 'add' ? actions.addTo : actions.removeFrom)(command.name, entry) }
      }
      case 'show': {
        const lists = (await read($, listsRef)) ?? { allow: [], deny: [] }
        return { text: listText(command.name, lists[command.name], (await read($, trustedRef)) !== false) }
      }
      case 'reconnect':
        return { text: await actions.reconnect() }
      case 'takeover':
        return { text: await actions.takeover() }
      case 'usage':
        return { text: USAGE }
    }
  })
}
