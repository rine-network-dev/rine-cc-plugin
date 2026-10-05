import { test, expect } from 'claude-code/testing'
import type { RineListEntry, RineLists } from '../types/index'
import { seal, writeSealed } from '../hooks/lib/envelope'
import { addEntry, confirmLists, pinIds, readLists, updateLists, type Sender, type TrustPort } from '../hooks/lib/lists'
import { statePath } from '../hooks/lib/refs'
import { at } from './at'
import { DIR } from './entry-kit'
import { createKit } from './kit'

const PATH = statePath(DIR, 'lists')
const BOB: RineListEntry = { kind: 'agent', handle: 'bob@acme.rine.network', agentId: null }
const EVE: RineListEntry = { kind: 'agent', handle: 'eve@acme.rine.network', agentId: null }
const OPS: RineListEntry = { kind: 'group', handle: '#ops@acme.rine.network', agentId: null }
const sender: Sender = { handle: 'bob@acme.rine.network', agentId: 'a-bob', groupHandle: null, groupId: null }
const lists = (allow: RineListEntry[], deny: RineListEntry[] = []): RineLists => ({ allow, deny })

function memoryTrust(): TrustPort & { digests: string[] } {
  const trust = {
    digests: [] as string[],
    load: async () => [...trust.digests],
    save: async (next: readonly string[]) => {
      trust.digests = [...next]
    }
  }
  return trust
}

test('test_updateLists_pinOfAnAlreadyPinnedSender_leavesTheFileIntact', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', { ...BOB, agentId: 'a-bob' })))
  const before = kit.fs.files.get(PATH)
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, (all, isTrusted) => (isTrusted ? pinIds(all, sender) : undefined)))
  expect(out.status).toBe('unchanged')
  expect(kit.fs.files.get(PATH)).toBe(before)
  expect((await readLists(kit.ports, trust, DIR)).lists.allow).toEqual([{ ...BOB, agentId: 'a-bob' }])
})

test('test_updateLists_pinOnUntrustedLists_changesNothing', async () => {
  const kit = createKit()
  await writeSealed(kit.ports, PATH, lists([BOB]))
  const before = kit.fs.files.get(PATH)
  const out = await kit.clock.settle(updateLists(kit.ports, memoryTrust(), DIR, (all, isTrusted) => (isTrusted ? pinIds(all, sender) : undefined)))
  expect(out.status).toBe('unchanged')
  expect(kit.fs.files.get(PATH)).toBe(before)
})

test('test_updateLists_editOfAnOutsideWrittenFile_staysUntrustedAndNeverBlessesTheAllow', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  await writeSealed(kit.ports, PATH, lists([BOB, EVE]))
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', OPS)))
  expect(out.status).toBe('ok')
  const view = await readLists(kit.ports, trust, DIR)
  expect(view.lists.allow).toEqual([BOB, EVE])
  expect(view.isTrusted).toBe(false)
})

test('test_confirmLists_afterAnUntrustedEdit_trustsTheFileAsItStands', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  await writeSealed(kit.ports, PATH, lists([BOB, EVE]))
  await confirmLists(kit.ports, trust, DIR)
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(true)
})

test('test_readLists_rollbackToAnOlderTrustedBody_isUntrusted', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  const older = kit.fs.files.get(PATH) ?? ''
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', EVE)))
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(true)
  kit.fs.files.set(PATH, older)
  const view = await readLists(kit.ports, trust, DIR)
  expect(view.lists.allow).toEqual([BOB])
  expect(view.isTrusted).toBe(false)
})

test('test_readLists_fileDeletedAfterARecordedWrite_isUntrustedNotEmptyAndTrusted', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', EVE)))
  kit.fs.files.delete(PATH)
  const view = await readLists(kit.ports, trust, DIR)
  expect(view.isTrusted).toBe(false)
  expect(view.lists).toEqual(lists([]))
})

test('test_confirmLists_deletedFile_resetsTheRecordSoAbsentReadsTrustedAgain', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', EVE)))
  kit.fs.files.delete(PATH)
  expect((await confirmLists(kit.ports, trust, DIR))?.isTrusted).toBe(true)
  expect(trust.digests).toEqual([])
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(true)
})

test('test_updateLists_afterAConfirmedDelete_startsFromEmptyAndTrusted', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  kit.fs.files.delete(PATH)
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', EVE)))
  expect(out.status).toBe('ok')
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(false)
  await confirmLists(kit.ports, trust, DIR)
  expect((await readLists(kit.ports, trust, DIR)).lists).toEqual(lists([], [EVE]))
})

test('test_readLists_unreadableFileWithNoGoodView_isUntrustedOnceARecordExists', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  kit.fs.files.set(PATH, `${await seal('{"allow":[1],"deny":[2]}')}`)
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(false)
})

test('test_updateLists_outsideWriteInTheReadBackWindow_leavesOnlyTheLatestTrustedDigest', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  const oldBody = kit.fs.files.get(PATH) ?? ''
  const write = kit.fs.write
  let isRaced = false
  kit.fs.write = async (path, text) => {
    await write(path, text)
    if (isRaced) return
    isRaced = true
    await writeSealed(kit.ports, PATH, lists([BOB, EVE]))
  }
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', OPS)))
  expect(trust.digests).toHaveLength(1)
  kit.fs.files.set(PATH, oldBody)
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(false)
})

test('test_readLists_aPairLeftByACrashBetweenTheTwoSaves_collapsesToTheNewestDigest', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  const oldBody = kit.fs.files.get(PATH) ?? ''
  const oldDigest = at(trust.digests, 0)
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', EVE)))
  trust.digests = [oldDigest, ...trust.digests]
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(true)
  expect(trust.digests).toHaveLength(1)
  kit.fs.files.set(PATH, oldBody)
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(false)
})
