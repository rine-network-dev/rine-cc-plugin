import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { RineEntry } from '../types/index'
import { makeEntry } from './entry-kit'

export const NOW = 1_600_000
export const SURFACES = ['terminal', 'desktop'] as const
export const BAND = { bodyColumns: 100, maxRows: 8, hasSurvey: false } as const
export const PANE = { title: 'rine', isFocused: true, bodyColumns: 100 } as const

export type Seeded = {
  values: Record<string, unknown>
  sets: [string, unknown][]
  opens: Record<string, unknown>[]
  closes: string[]
  /** Every `ui.open` and `ui.close`, in call order, as `open:<id>` / `close:<id>`. */
  order: string[]
  toasts: string[]
  calls: { server: string; tool: string; args: Record<string, unknown> }[]
  isPlaced: boolean
  isCallFailing: boolean
  /** The props each render reached the engine's own component with, in order, as `<component>`. */
  rendered: { component: string; props: Record<string, unknown> }[]
}

export function entry(over: Partial<RineEntry> = {}): RineEntry {
  return makeEntry({ receivedAt: NOW - 120_000, ...over })
}

const BASE = {
  identity: { handle: 'alice@acme.rine.network', agentId: 'agent-own', configDir: '/rine', cliVersion: '1.0.0', isBelowFloor: false, isStateWritable: true },
  stream: { phase: 'live', attempt: 0, lastFrameAt: NOW, nextRetryAt: null, ownerCwd: null, unreadable: 0 },
  prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: false, isMotion: false },
  entries: [],
  lists: { allow: [], deny: [] },
  isListsTrusted: true,
  isOwner: true
}

/** Answers `$.state`, `$.ui.open`/`close`/`toast`, `$.mcp.call` and the clock beneath the plugin, and records what it was asked. */
export function seedUi(on: On, over: Record<string, unknown> = {}): Seeded {
  const seeded: Seeded = { values: { ...BASE, ...over }, sets: [], opens: [], closes: [], order: [], toasts: [], calls: [], isPlaced: true, isCallFailing: false, rendered: [] }
  const slot = (e: { key: string; id?: string }): string => (e.id === undefined ? e.key : `${e.key}:${e.id}`)
  mock.clock(on, { now: NOW })
  on('state.get', async (_$, e) => ({ value: { value: seeded.values[slot(e)], version: 1 } }) as never)
  on('state.set', async (_$, e) => {
    seeded.values[slot(e)] = e.value
    seeded.sets.push([slot(e), e.value])
    return { value: { isSet: true, version: 2 } } as never
  })
  on('ui.open', async (_$, e) => {
    seeded.opens.push(e as never)
    seeded.order.push(`open:${e.id}`)
    return { value: seeded.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'terminal too narrow' } } as never
  })
  on('ui.close', async (_$, e) => {
    seeded.closes.push(e.id)
    seeded.order.push(`close:${e.id}`)
    return { value: undefined } as never
  })
  on('ui.toast', async (_$, e) => {
    seeded.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('mcp.call', async (_$, e) => {
    seeded.calls.push({ server: e.server, tool: e.tool, args: e.args })
    return { value: { content: [], isError: seeded.isCallFailing } } as never
  })
  on('ui.render', async (_$, e) => {
    seeded.rendered.push({ component: e.component, props: e.props as never })
    return { type: 'Text', children: ['engine'] } as never
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  return seeded
}
