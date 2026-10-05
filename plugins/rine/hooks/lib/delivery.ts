import type { RineEntry } from '../../types/index'
import { toNote, type DeliveryStore, type Say } from './delivery-core'
import { arrivalToast, createToaster, SUFFIX } from './delivery-toast'
import { createWaker, type Candidate, type CompleteEvent, type HandOffResult, type StepEvent, type TurnEvent } from './delivery-wake'
import type { Lease } from './lease'
import { appendEntry, patchEntries, summarizeBacklog } from './ledger'
import type { Sender } from './lists'
import { notifyRow, SUMMARY_MAX, startupSummary } from './model-text'
import type { Ports } from './ports'
import { createReader, loadPreview } from './preview'
import { route, senderOf, toEntry } from './router'
import type { StreamMessage } from './frames'
import { safeLine } from './sanitize'

export type DeliveryDeps = {
  ports: Pick<Ports, 'clock' | 'sink' | 'run'>
  store: DeliveryStore
  lease: Pick<Lease, 'isStillOwner' | 'wakes' | 'recordWake'>
  /** Ids that came off the ledger file at start; they count as "earlier". */
  carried: () => ReadonlySet<string>
  changed: () => void
  /** Pins the sender's id into the allowlist after a verified wake. */
  pinSender: (sender: Sender) => Promise<void>
  onWoke: (at: number) => void
  log: (text: string) => void
}

export type Delivery = {
  onMessage: (message: StreamMessage, isBacklog: boolean) => Promise<void>
  onSettled: () => Promise<void>
  /** A non-owner announces what the owner recorded. */
  announce: (entries: readonly RineEntry[]) => Promise<void>
  turnStart: (event: TurnEvent) => Promise<void>
  turnStep: (event: StepEvent) => void
  turnComplete: (event: CompleteEvent) => Promise<void>
  handOff: (ids: readonly string[]) => Promise<HandOffResult>
}

export function createDelivery(deps: DeliveryDeps): Delivery {
  const { ports, store } = deps
  const reader = createReader(ports.run)
  const toaster = createToaster({
    sink: ports.sink,
    clock: ports.clock,
    isMuted: async () => (await store.read()).isMuted,
    log: deps.log
  })
  const say: Say = toaster.say
  let tail: Promise<void> = Promise.resolve()

  /** Messages are handled one at a time, in arrival order; a failure is logged and the line moves on. */
  const serial = (job: () => Promise<void>): Promise<void> => {
    tail = tail.then(job).catch(() => deps.log('rine: delivery step failed'))
    return tail
  }

  const notifyRows = async (entries: readonly RineEntry[]): Promise<number | null> => {
    const index = await ports.sink.append(notifyRow(entries.map(toNote)))
    if (index !== null) {
      const ids = entries.map((entry) => entry.id)
      await store.updateEntries((all) => patchEntries(all, ids, { rowIndex: index }))
      deps.changed()
    }
    return index
  }

  const waker = createWaker({
    ports,
    store,
    reader,
    lease: deps.lease,
    say,
    notifyRows,
    pinSender: deps.pinSender,
    onWoke: deps.onWoke,
    changed: deps.changed,
    log: deps.log
  })

  const notify = async (entry: RineEntry, rebound: string | null): Promise<RineEntry> => {
    const rowIndex = await notifyRows([entry])
    say(entry, arrivalToast(entry, null))
    if (rebound !== null) ports.sink.toast(`rine: ${safeLine(rebound, 48)} is now a different agent`)
    return { ...entry, rowIndex }
  }

  const handle = async (message: StreamMessage, isBacklog: boolean): Promise<void> => {
    const view = await store.read()
    const now = await ports.clock.now()
    const intent = route(message, {
      ownAgentId: view.identity.agentId,
      lists: view.lists.lists,
      isPreview: view.isPreview,
      isMuted: view.isMuted,
      isBacklog
    })
    const entry = toEntry(message, intent, now)
    if (entry === null) return
    if (!appendEntry(view.entries, entry).isNew) return
    await store.updateEntries((all) => appendEntry(all, entry).entries)
    deps.changed()
    if (intent.action === 'hold') {
      if (!isBacklog) say(entry, arrivalToast(entry, SUFFIX.held))
      if (view.identity.isStateWritable) {
        void loadPreview(reader, store.setPreview, entry.id, view.identity.configDir).catch(() => deps.log('rine: preview failed'))
      }
      return
    }
    if (intent.action !== 'notify' && intent.action !== 'wake') return
    const candidate: Candidate = { entry, sender: senderOf(message), intent, isInbound: intent.isWebhook || message.direction === 'received' }
    if (intent.action === 'notify') {
      await notify(entry, intent.reboundHandle)
    } else if (view.isBusy || view.pendingWake) {
      waker.watch({ ...candidate, entry: await notify(entry, null) })
    } else {
      waker.attempt(candidate)
    }
  }

  const settle = async (): Promise<void> => {
    const view = await store.read()
    const summary = summarizeBacklog(view.entries, deps.carried())
    if (summary.entries.length === 0 || view.isMuted) return
    ports.sink.toast(`rine: ${summary.arrived} new while offline, ${summary.earlier} unread from earlier`)
    if (!view.isPreview) {
      await ports.sink.append(startupSummary(summary.arrived, summary.earlier, summary.entries.map(toNote)))
    }
  }

  const announce = async (entries: readonly RineEntry[]): Promise<void> => {
    const view = await store.read()
    if (view.isMuted || view.isPreview) return
    for (let at = 0; at < entries.length; at += SUMMARY_MAX) {
      await ports.sink.append(notifyRow(entries.slice(at, at + SUMMARY_MAX).map(toNote)))
    }
  }

  return {
    onMessage: (message, isBacklog) => serial(() => handle(message, isBacklog)),
    onSettled: () => serial(settle),
    announce,
    turnStart: waker.turnStart,
    turnStep: waker.turnStep,
    turnComplete: waker.turnComplete,
    handOff: waker.handOff
  }
}
