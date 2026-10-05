import { test, expect } from 'claude-code/testing'
import { seal } from '../hooks/lib/envelope'
import { FLUSH_DELAY_MS, createLedgerWriter, loadLedger, saveLedger } from '../hooks/lib/ledger-file'
import { EMPTY_LEDGER, LEDGER_CAP, type LedgerFile } from '../hooks/lib/ledger'
import { statePath } from '../hooks/lib/refs'
import { at } from './at'
import { DIR, makeEntry } from './entry-kit'
import { createKit, splice } from './kit'
import { tick } from './tick'

const PATH = statePath(DIR, 'ledger')
const ledger = (...ids: string[]): LedgerFile => ({
  v: 1,
  entries: ids.map((id) => makeEntry({ id, receivedAt: 1_000_000 })),
  appliedRequests: []
})

test('test_loadLedger_absentFile_isEmpty', async () => {
  expect(await loadLedger(createKit().ports, DIR)).toEqual(EMPTY_LEDGER)
})

test('test_loadLedger_tornTwice_isEmpty', async () => {
  const kit = createKit()
  const torn = splice(await seal(JSON.stringify(ledger('a', 'b'))), await seal(JSON.stringify(ledger('c'))))
  kit.fs.injectReads(PATH, [torn, torn])
  expect(await kit.clock.settle(loadLedger(kit.ports, DIR))).toEqual(EMPTY_LEDGER)
})

test('test_saveLedger_concurrentOwnersEntries_areKept', async () => {
  const kit = createKit()
  await saveLedger(kit.ports, DIR, ledger('theirs'))
  const saved = await saveLedger(kit.ports, DIR, ledger('mine'))
  expect(saved.entries.map((entry) => entry.id).sort()).toEqual(['mine', 'theirs'])
  expect((await loadLedger(kit.ports, DIR)).entries).toHaveLength(2)
})

test('test_saveLedger_appliedRequests_followMemoryAndForgetPrunedIds', async () => {
  const kit = createKit()
  await saveLedger(kit.ports, DIR, { ...ledger('a'), appliedRequests: ['r1'] })
  const saved = await saveLedger(kit.ports, DIR, { ...ledger('a'), appliedRequests: ['r2'] })
  expect(saved.appliedRequests).toEqual(['r2'])
})

test('test_saveLedger_heldOverCap_reportsDroppedHeld', async () => {
  const kit = createKit()
  const held = Array.from({ length: LEDGER_CAP + 3 }, (_, i) => makeEntry({ id: `h${i}`, disposition: 'held', receivedAt: i + 1 }))
  const saved = await saveLedger(kit.ports, DIR, { v: 1, entries: held, appliedRequests: [] })
  expect(saved.droppedHeld).toBe(3)
  expect(saved.entries).toHaveLength(LEDGER_CAP)
})

async function until(isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !isDone(); i++) await tick()
}

function writerKit() {
  const kit = createKit()
  const merged: LedgerFile[] = []
  const errors: unknown[] = []
  const writer = createLedgerWriter(kit.ports, DIR, {
    snapshot: () => ledger('a'),
    onMerged: (file) => {
      merged.push(file)
    },
    onError: (error) => {
      errors.push(error)
    }
  })
  return { kit, writer, merged, errors }
}

test('test_createLedgerWriter_twoSchedules_writeOnceAfterTheDelay', async () => {
  const { kit, writer, merged } = writerKit()
  writer.schedule()
  writer.schedule()
  await kit.clock.advance(FLUSH_DELAY_MS - 1)
  expect(kit.fs.files.has(PATH)).toBe(false)
  await kit.clock.advance(1)
  await until(() => merged.length > 0)
  await kit.clock.advance(FLUSH_DELAY_MS * 2)
  expect(kit.fs.files.has(PATH)).toBe(true)
  expect(merged).toHaveLength(1)
})

test('test_createLedgerWriter_scheduleAfterFlush_startsANewWindow', async () => {
  const { kit, writer, merged } = writerKit()
  writer.schedule()
  await kit.clock.advance(FLUSH_DELAY_MS)
  await until(() => merged.length > 0)
  writer.schedule()
  await kit.clock.advance(FLUSH_DELAY_MS)
  await until(() => merged.length > 1)
  expect(merged).toHaveLength(2)
})

test('test_createLedgerWriter_cancelBeforeTheDelay_writesNothing', async () => {
  const { kit, writer, merged } = writerKit()
  writer.schedule()
  writer.cancel()
  await kit.clock.advance(FLUSH_DELAY_MS * 3)
  expect(kit.fs.files.has(PATH)).toBe(false)
  expect(merged).toHaveLength(0)
})

test('test_createLedgerWriter_scheduleAfterCancel_writesAgain', async () => {
  const { kit, writer, merged } = writerKit()
  writer.schedule()
  writer.cancel()
  writer.schedule()
  await kit.clock.advance(FLUSH_DELAY_MS)
  await until(() => merged.length > 0)
  expect(merged).toHaveLength(1)
})

test('test_createLedgerWriter_writeFails_callsOnError', async () => {
  const { kit, writer, errors } = writerKit()
  kit.fs.isWriteFailing = true
  writer.schedule()
  await kit.clock.advance(FLUSH_DELAY_MS)
  await until(() => errors.length > 0)
  expect(errors).toHaveLength(1)
})

test('test_createLedgerWriter_flush_handsOnMergedTheSnapshotItWrote', async () => {
  const kit = createKit()
  const written: LedgerFile[] = []
  const writer = createLedgerWriter(kit.ports, DIR, {
    snapshot: () => ledger('a'),
    onMerged: (_merged, _dropped, snapshot) => {
      written.push(snapshot)
    },
    onError: () => undefined
  })
  await writer.flush()
  expect(at(written, 0).entries.map((entry) => entry.id)).toEqual(['a'])
})

test('test_createLedgerWriter_flush_writesAtOnce', async () => {
  const { kit, writer, merged } = writerKit()
  await writer.flush()
  expect(kit.fs.files.has(PATH)).toBe(true)
  expect(at(merged, 0).entries.map((entry) => entry.id)).toEqual(['a'])
})
