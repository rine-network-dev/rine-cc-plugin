import type { RineEntry } from '../../types/index'
import type { Say } from './delivery-core'
import type { ClockPort, Sink } from './ports'
import { noticeText, shortType } from './model-text'
import type { Downgrade } from './router'
import { safeLine } from './sanitize'

export const BATCH_WINDOW_MS = 3000
export const TOAST_CELLS = 80

export const SUFFIX = { held: 'held for review', waking: 'waking Claude', unverified: 'not verified, not woken' } as const

export function arrivalToast(entry: RineEntry, suffix: string | null): string {
  const from = safeLine(entry.from, 32)
  const head = entry.group === null ? `${from} → you` : `${from} in ${safeLine(entry.group, 32)}`
  const parts = [head, shortType(entry.type)]
  if (suffix !== null) parts.push(suffix)
  return safeLine(parts.join(' · '), TOAST_CELLS)
}

function plural(count: number, word: string): string {
  return count === 1 ? `${count} ${word}` : `${count} ${word}s`
}

export function batchToast(count: number, senders: number): string {
  return `rine: ${count} more from ${plural(senders, 'sender')}`
}

function batchNotice(count: number, senders: number): string {
  return `rine: ${plural(count, 'new message')} from ${plural(senders, 'sender')}`
}

/** The toast a failed wake gate shows in place of the arrival toast, or null when the plain arrival toast stands. */
export function downgradeToast(reason: Downgrade, entry: RineEntry): string | null {
  if (reason === 'unverified') return arrivalToast(entry, SUFFIX.unverified)
  if (reason === 'rate-limit') return 'rine: wake limit reached'
  if (reason === 'lists-untrusted') return 'rine: lists changed outside /rine'
  if (reason === 'bypass') return 'rine: not woken: permissions bypassed'
  if (reason === 'mode-unknown') return 'rine: not woken until you type a prompt'
  return null
}

export function droppedToast(what: 'wake' | 'hand-off', reason: string): string {
  return safeLine(`rine: ${what} dropped (${safeLine(reason, 40)})`, TOAST_CELLS)
}

export type ToasterDeps = {
  sink: Pick<Sink, 'toast' | 'notice'>
  clock: Pick<ClockPort, 'sleep'>
  isMuted: () => Promise<boolean>
  log: (text: string) => void
}

/** The first toast of a quiet period shows at once, the next 3 s collapse into one; each toast adds a system notice. */
export function createToaster(deps: ToasterDeps): { say: Say } {
  let isOpen = false
  const pending: string[] = []

  const flush = async (): Promise<void> => {
    isOpen = false
    const batch = pending.splice(0)
    if (batch.length === 0) return
    const senders = new Set(batch).size
    deps.sink.toast(batchToast(batch.length, senders))
    await deps.sink.notice(batchNotice(batch.length, senders))
  }

  const show = async (entry: RineEntry, text: string): Promise<void> => {
    if (await deps.isMuted()) return
    if (isOpen) {
      pending.push(entry.from)
      return
    }
    isOpen = true
    deps.sink.toast(safeLine(text, TOAST_CELLS))
    void deps.clock.sleep(BATCH_WINDOW_MS).then(flush).catch(() => deps.log('rine: toast batch failed'))
    await deps.sink.notice(noticeText(entry.from, entry.type))
  }

  return {
    say: (entry, text) => {
      void show(entry, text).catch(() => deps.log('rine: toast failed'))
    }
  }
}
