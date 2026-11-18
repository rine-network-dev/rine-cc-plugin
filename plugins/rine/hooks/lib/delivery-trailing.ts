import { isStillWakeable, type Candidate } from './delivery-check'
import type { DeliveryStore } from './delivery-core'
import type { Lease } from './lease'
import type { Ports } from './ports'
import { isHourlyCapReached, spacingWaitMs } from './wake-limits'

export type TrailingDeps = {
  log: (text: string) => void
  ports: Pick<Ports, 'clock'>
  store: DeliveryStore
  lease: Pick<Lease, 'isStillOwner' | 'wakes'>
  /** Queues all candidates together, so they share one wake text. */
  attempt: (candidates: readonly Candidate[]) => void
  /** Hands a candidate to the next `turn.complete` retry. */
  watch: (candidate: Candidate) => void
}

export type Trailing = {
  /** Holds a candidate the 30 s spacing refused until the spacing is over; the hourly cap holds nothing. */
  defer: (candidate: Candidate) => Promise<void>
}

/** One trailing wake: the candidates the spacing refused try again together once it is over. */
export function createTrailing(deps: TrailingDeps): Trailing {
  const { ports, store, lease } = deps
  const deferred = new Map<string, Candidate>()
  let isArmed = false

  const release = async (): Promise<void> => {
    isArmed = false
    const batch = [...deferred.values()]
    deferred.clear()
    const wakeable: Candidate[] = []
    for (const c of batch) if (await isStillWakeable(store, c)) wakeable.push(c)
    if (wakeable.length === 0 || !(await lease.isStillOwner())) return
    const view = await store.read()
    if (view.isBusy || view.pendingWake) wakeable.forEach(deps.watch)
    else deps.attempt(wakeable)
  }

  return {
    defer: async (candidate) => {
      const now = await ports.clock.now()
      const wakes = lease.wakes()
      if (isHourlyCapReached(wakes, now)) return
      deferred.set(candidate.entry.id, candidate)
      if (isArmed) return
      isArmed = true
      void ports.clock.sleep(spacingWaitMs(wakes, now)).then(release).catch(() => {
        isArmed = false
        deps.log('rine: trailing wake failed')
      })
    }
  }
}
