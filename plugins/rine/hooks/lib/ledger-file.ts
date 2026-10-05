import { readSealed, writeSealed } from './envelope'
import { EMPTY_LEDGER, mergeEntries, normalizeLedger, pruneEntries, type LedgerFile } from './ledger'
import type { Ports } from './ports'
import { statePath } from './refs'

export const FLUSH_DELAY_MS = 1000

export type Saved = LedgerFile & { droppedHeld: number }

export type LedgerWriterOptions = {
  /** The owner's current entries and applied request ids. */
  snapshot: () => LedgerFile
  /** Receives what was written and the snapshot it was built from, so memory adopts a concurrent owner's entries without losing newer changes. */
  onMerged: (merged: LedgerFile, droppedHeld: number, written: LedgerFile) => void
  onError: (error: unknown) => void
}

export type LedgerWriter = { schedule: () => void; cancel: () => void; flush: () => Promise<void> }

/** The file as the owner last wrote it. Absent, torn or unreadable reads as empty. */
export async function loadLedger(ports: Pick<Ports, 'fs' | 'clock'>, rineDir: string): Promise<LedgerFile> {
  const sealed = await readSealed(ports, statePath(rineDir, 'ledger'))
  return (sealed.status === 'ok' ? normalizeLedger(sealed.value) : null) ?? EMPTY_LEDGER
}

/** Merge-on-write: read the file, union it with memory, prune, write. Applied request ids are memory's: the tick prunes them, a union would never forget one. */
export async function saveLedger(ports: Pick<Ports, 'fs' | 'clock'>, rineDir: string, memory: LedgerFile): Promise<Saved> {
  const file = await loadLedger(ports, rineDir)
  const pruned = pruneEntries(mergeEntries(file.entries, memory.entries), await ports.clock.now())
  const merged: LedgerFile = { v: 1, entries: pruned.entries, appliedRequests: memory.appliedRequests }
  await writeSealed(ports, statePath(rineDir, 'ledger'), merged)
  return { ...merged, droppedHeld: pruned.droppedHeld }
}

/** The owner's 1 s debounce. A step-down calls `cancel`, which also voids a flush still asleep. */
export function createLedgerWriter(
  ports: Pick<Ports, 'fs' | 'clock'>,
  rineDir: string,
  options: LedgerWriterOptions
): LedgerWriter {
  let generation = 0
  let isPending = false
  const flush = async (): Promise<void> => {
    const written = options.snapshot()
    const { droppedHeld, ...merged } = await saveLedger(ports, rineDir, written)
    options.onMerged(merged, droppedHeld, written)
  }
  return {
    flush,
    cancel: () => {
      generation += 1
      isPending = false
    },
    schedule: () => {
      if (isPending) return
      isPending = true
      const mine = generation
      void ports.clock
        .sleep(FLUSH_DELAY_MS)
        .then(() => {
          if (mine !== generation) return undefined
          isPending = false
          return flush()
        })
        .catch((error: unknown) => {
          if (mine === generation) isPending = false
          options.onError(error)
        })
    }
  }
}
