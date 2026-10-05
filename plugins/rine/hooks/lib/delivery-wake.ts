import type { RineEntry } from '../../types/index'
import { toNote, type DeliveryStore, type Say } from './delivery-core'
import { arrivalToast, downgradeToast, droppedToast, SUFFIX } from './delivery-toast'
import type { Lease } from './lease'
import { createChecker, type Candidate } from './delivery-check'
import { markHanded, patchEntries } from './ledger'
import type { Sender } from './lists'
import { settleQuietly } from './delivery-quiet'
import { handoffText, wakeText } from './model-text'
import type { Ports } from './ports'
import type { Reader } from './preview'
import type { Downgrade } from './router'

export const ABORT_COOLDOWN_MS = 5 * 60 * 1000
/** Main turns that may start ahead of a submitted wake (prompts the person queued) before the wait is given up. */
export const MAX_TURNS_AHEAD_OF_WAKE = 3

export type { Candidate }
export type TurnEvent = { agentId?: string; text?: string }
export type StepEvent = TurnEvent & { messageCount: number }
export type CompleteEvent = TurnEvent & { reason: 'answer' | 'aborted' | 'refusal' | 'error' }
export type HandOffResult = { status: 'empty' | 'submitted' | 'queued' } | { status: 'dropped'; reason: string }

export type WakeDeps = {
  ports: Pick<Ports, 'clock' | 'sink'>
  store: DeliveryStore
  reader: Reader
  lease: Pick<Lease, 'isStillOwner' | 'wakes' | 'recordWake'>
  say: Say
  /** Appends a notify row for entries that have none and answers its index (null when refused). */
  notifyRows: (entries: readonly RineEntry[]) => Promise<number | null>
  pinSender: (sender: Sender) => Promise<void>
  onWoke: (at: number) => void
  changed: () => void
  log: (text: string) => void
}

export type Waker = {
  /** Idle path: queue the candidate for verification and a wake. */
  attempt: (candidate: Candidate) => void
  /** Busy path: a notify row is already appended; a wake follows at `turn.complete` if the row stays unseen. */
  watch: (candidate: Candidate) => void
  turnStart: (event: TurnEvent) => Promise<void>
  turnStep: (event: StepEvent) => void
  turnComplete: (event: CompleteEvent) => Promise<void>
  handOff: (ids: readonly string[]) => Promise<HandOffResult>
}

export function createWaker(deps: WakeDeps): Waker {
  const { ports, store, lease } = deps
  let queue: Candidate[] = []
  let waiting: Candidate[] = []
  let isDraining = false
  let hasToldUntrusted = false
  const checker = createChecker(deps)
  /** The text of a wake submitted whose own turn has not started: a turn that completes meanwhile is the person's. */
  let awaitedText: string | null = null
  /** Main turns started since the wake was submitted without matching it; bounds the wait so a missed match cannot pin `pendingWake`. */
  let turnsAhead = 0

  const downgrade = async (c: Candidate, reason: Downgrade): Promise<void> => {
    if (reason === 'denied' || reason === 'muted' || reason === 'preview') return settleQuietly(deps, c, reason)
    if (c.entry.rowIndex === null) await deps.notifyRows([c.entry])
    const isRepeat = reason === 'lists-untrusted' && hasToldUntrusted
    if (reason === 'lists-untrusted') hasToldUntrusted = true
    deps.say(c.entry, (isRepeat ? null : downgradeToast(reason, c.entry)) ?? arrivalToast(c.entry, null))
  }

  const isStillWakeable = async (c: Candidate): Promise<boolean> => {
    const current = (await store.read()).entries.find((entry) => entry.id === c.entry.id)
    return current !== undefined && current.state === 'unread' && current.disposition === 'notified'
  }

  const fire = async (batch: Candidate[]): Promise<void> => {
    if (!(await lease.isStillOwner())) {
      for (const c of batch) await downgrade(c, 'not-owner')
      return
    }
    const ready: Candidate[] = []
    for (const c of batch) {
      if (!(await isStillWakeable(c))) continue
      const reason = await checker.recheck(c)
      if (reason === null) ready.push(c)
      else await downgrade(c, reason)
    }
    if (ready.length === 0) return
    const text = wakeText(ready.map((c) => toNote(c.entry)))
    awaitedText = text
    turnsAhead = 0
    await store.patch({ pendingWake: true })
    const result = await ports.sink.submit(text)
    if (result.isDropped) {
      awaitedText = null
      await store.patch({ pendingWake: false })
      for (const c of ready) if (c.entry.rowIndex === null) await deps.notifyRows([c.entry])
      const first = ready[0]
      if (first !== undefined) deps.say(first.entry, droppedToast('wake', result.reason))
      return
    }
    // Another plugin's prompt.submit may rewrite the wake; its own turn carries what entered.
    if (awaitedText === text) awaitedText = result.entered
    const now = await ports.clock.now()
    await lease.recordWake(now)
    const ids = ready.map((c) => c.entry.id)
    await store.updateEntries((entries) => patchEntries(entries, ids, { disposition: 'woken' }))
    deps.changed()
    deps.onWoke(now)
    for (const c of ready) {
      deps.say(c.entry, arrivalToast(c.entry, SUFFIX.waking))
      if (!c.intent.isWebhook) void deps.pinSender(c.sender).catch(() => deps.log('rine: pinning a verified sender failed'))
    }
  }

  const drain = async (): Promise<void> => {
    try {
      while (queue.length > 0) {
        const batch = queue
        queue = []
        const ready: Candidate[] = []
        for (const c of batch) {
          try {
            if (!(await isStillWakeable(c))) continue
            const reason = await checker.check(c)
            if (reason === null) ready.push(c)
            else await downgrade(c, reason)
          } catch {
            deps.log('rine: wake check failed')
          }
        }
        if (ready.length > 0) await fire(ready)
      }
    } finally {
      isDraining = false
    }
  }

  const attempt = (candidate: Candidate): void => {
    queue.push(candidate)
    if (isDraining) return
    isDraining = true
    void drain().catch(() => deps.log('rine: wake failed'))
  }

  return {
    attempt,
    watch: (candidate) => {
      waiting.push(candidate)
    },
    turnStart: async (event) => {
      if (event.agentId !== undefined) return
      if (awaitedText !== null) {
        const isOwnTurn = event.text?.includes(awaitedText) === true
        if (isOwnTurn || ++turnsAhead > MAX_TURNS_AHEAD_OF_WAKE) awaitedText = null
      }
      await store.patch({ isBusy: true })
    },
    turnStep: (event) => {
      if (event.agentId !== undefined) return
      // The row's index is the message count right after its append, so a request carrying that many messages holds it.
      waiting = waiting.filter((c) => c.entry.rowIndex === null || event.messageCount < c.entry.rowIndex)
    },
    turnComplete: async (event) => {
      if (event.agentId !== undefined) return
      await store.patch(awaitedText !== null ? { isBusy: false } : { isBusy: false, pendingWake: false })
      const unseen = waiting
      waiting = []
      if (event.reason === 'aborted') {
        await store.patch({ wakeCooldownUntil: (await ports.clock.now()) + ABORT_COOLDOWN_MS })
      } else if (event.reason === 'answer') {
        for (const c of unseen) attempt(c)
      }
    },
    handOff: async (ids) => {
      const view = await store.read()
      const entries = view.entries.filter((entry) => ids.includes(entry.id))
      if (entries.length === 0) return { status: 'empty' }
      const result = await ports.sink.submit(handoffText(entries.map(toNote)))
      if (result.isDropped) {
        ports.sink.toast(droppedToast('hand-off', result.reason))
        return { status: 'dropped', reason: result.reason }
      }
      await store.updateEntries((all) => markHanded(all, ids))
      deps.changed()
      if (view.isBusy) ports.sink.toast('rine: queued for Claude')
      return { status: view.isBusy ? 'queued' : 'submitted' }
    }
  }
}
