import { test, expect } from 'claude-code/testing'
import type { RineListEntry, RineLists } from '../types/index'
import { digestHex, seal, writeSealed } from '../hooks/lib/envelope'
import {
  addEntry,
  confirmLists,
  matchLists,
  MAX_ENTRIES,
  parseHandle,
  pinIds,
  readLists,
  removeEntry,
  updateLists,
  type Sender,
  type TrustPort
} from '../hooks/lib/lists'
import { statePath } from '../hooks/lib/refs'
import { DIR } from './entry-kit'
import { createKit, splice } from './kit'

const PATH = statePath(DIR, 'lists')
const BOB: RineListEntry = { kind: 'agent', handle: 'bob@acme.rine.network', agentId: null }
const OPS: RineListEntry = { kind: 'group', handle: '#ops@acme.rine.network', agentId: null }
const sender: Sender = { handle: 'bob@acme.rine.network', agentId: 'a-bob', groupHandle: null, groupId: null }

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

const lists = (allow: RineListEntry[], deny: RineListEntry[] = []): RineLists => ({ allow, deny })

test('test_parseHandle_validHandles_lowerCaseAndKind', () => {
  expect(parseHandle(' Bob@Acme.rine.network ')).toEqual(BOB)
  expect(parseHandle('#Ops@acme.rine.network')).toEqual(OPS)
})

test('test_parseHandle_malformed_isNull', () => {
  for (const raw of ['bob', 'bob@', '@acme', 'bob@acme network', '##ops@acme', '']) expect(parseHandle(raw)).toBeNull()
})

test('test_matchLists_allowByHandle_ignoresCase', () => {
  const upper = { ...sender, handle: 'BOB@acme.rine.network' }
  expect(matchLists(lists([BOB]), upper)).toEqual({ list: 'allow', reboundHandle: null })
})

test('test_matchLists_denyBeatsAllow', () => {
  expect(matchLists(lists([BOB], [BOB]), sender).list).toBe('deny')
})

test('test_matchLists_denyByPinnedIdAfterHandleChange', () => {
  const renamed = { ...sender, handle: 'new@acme.rine.network' }
  expect(matchLists(lists([], [{ ...BOB, agentId: 'a-bob' }]), renamed).list).toBe('deny')
})

test('test_matchLists_denyWithNullSenderHandle_matchesById', () => {
  expect(matchLists(lists([], [{ ...BOB, agentId: 'a-bob' }]), { ...sender, handle: null }).list).toBe('deny')
})

test('test_matchLists_pinnedIdMismatch_isNoneAndReportsRebound', () => {
  const match = matchLists(lists([{ ...BOB, agentId: 'a-other' }]), sender)
  expect(match).toEqual({ list: 'none', reboundHandle: BOB.handle })
})

test('test_matchLists_unpinnedAllowWithOtherHandle_isNone', () => {
  expect(matchLists(lists([BOB]), { ...sender, handle: 'eve@acme.rine.network' }).list).toBe('none')
})

test('test_matchLists_groupAllow_matchesGroupHandleAndPinnedGroupId', () => {
  const inGroup = { ...sender, groupHandle: '#ops@acme.rine.network', groupId: 'g-1' }
  expect(matchLists(lists([OPS]), inGroup).list).toBe('allow')
  expect(matchLists(lists([{ ...OPS, agentId: 'g-2' }]), inGroup).list).toBe('none')
  expect(matchLists(lists([OPS]), sender).list).toBe('none')
})

test('test_matchLists_groupDeny_beatsSenderAllow', () => {
  const inGroup = { ...sender, groupHandle: '#ops@acme.rine.network', groupId: 'g-1' }
  expect(matchLists(lists([BOB], [OPS]), inGroup).list).toBe('deny')
})

test('test_pinIds_unpinnedEntries_getTheirIds', () => {
  const inGroup = { ...sender, groupHandle: '#ops@acme.rine.network', groupId: 'g-1' }
  const pinned = pinIds(lists([BOB, OPS], [OPS]), inGroup)
  expect(pinned?.allow).toEqual([{ ...BOB, agentId: 'a-bob' }, { ...OPS, agentId: 'g-1' }])
  expect(pinned?.deny).toEqual([{ ...OPS, agentId: 'g-1' }])
})

test('test_pinIds_nothingToPin_isUndefined', () => {
  expect(pinIds(lists([{ ...BOB, agentId: 'a-old' }]), sender)).toBeUndefined()
  expect(pinIds(lists([OPS]), sender)).toBeUndefined()
})

test('test_addEntry_allowRemovesFromDeny_andKeepsAnExistingPin', () => {
  const start = lists([{ ...BOB, agentId: 'a-bob' }], [BOB])
  const next = addEntry(start, 'allow', BOB)
  expect(next?.allow).toEqual([{ ...BOB, agentId: 'a-bob' }])
  expect(next?.deny).toEqual([])
})

test('test_addEntry_listFull_isUndefined', () => {
  const full = Array.from({ length: MAX_ENTRIES }, (_, i) => ({ ...BOB, handle: `u${i}@acme.rine.network` }))
  expect(addEntry(lists(full), 'allow', BOB)).toBeUndefined()
  expect(addEntry(lists(full), 'deny', BOB)?.deny).toHaveLength(1)
})

test('test_removeEntry_dropsOnlyThatList', () => {
  const next = removeEntry(lists([BOB], [BOB]), 'allow', BOB)
  expect(next).toEqual(lists([], [BOB]))
})

test('test_readLists_absentFile_isEmptyAndTrusted', async () => {
  const view = await readLists(createKit().ports, memoryTrust(), DIR)
  expect(view).toEqual({ lists: lists([]), digest: null, isTrusted: true })
})

test('test_updateLists_modWrite_isRecordedAndTrusted', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  expect(out.status).toBe('ok')
  const view = await readLists(kit.ports, trust, DIR)
  expect(view.isTrusted).toBe(true)
  expect(view.lists.allow).toEqual([BOB])
  expect(view.digest).toBe(await digestHex(JSON.stringify(lists([BOB]))))
})

test('test_readLists_externalEdit_isUntrusted', async () => {
  const kit = createKit()
  await writeSealed(kit.ports, PATH, lists([BOB], [OPS]))
  const view = await readLists(kit.ports, memoryTrust(), DIR)
  expect(view.isTrusted).toBe(false)
})

test('test_confirmLists_recordsCurrentDigest_thenTrusted', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await writeSealed(kit.ports, PATH, lists([BOB]))
  expect((await confirmLists(kit.ports, trust, DIR))?.isTrusted).toBe(true)
  expect((await readLists(kit.ports, trust, DIR)).isTrusted).toBe(true)
})

test('test_confirmLists_absentFile_isEmptyAndTrusted', async () => {
  expect(await confirmLists(createKit().ports, memoryTrust(), DIR)).toEqual({ lists: lists([]), digest: null, isTrusted: true })
})

test('test_readLists_tornTwice_keepsLastGoodView', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  const good = await readLists(kit.ports, trust, DIR)
  const torn = splice(await seal('{"allow":[],"deny":[]}'), await seal('{"allow":[1],"deny":[2]}'))
  kit.fs.injectReads(PATH, [torn, torn])
  expect(await kit.clock.settle(readLists(kit.ports, trust, DIR, good))).toEqual(good)
})

test('test_updateLists_readBackMismatch_retriesOnce', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', BOB)))
  const current = kit.fs.files.get(PATH) ?? ''
  kit.fs.injectReads(PATH, [current, await seal('{"allow":[],"deny":[]}')])
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'deny', OPS)))
  expect(out.status).toBe('ok')
  expect((await readLists(kit.ports, trust, DIR)).lists.deny).toEqual([OPS])
})

test('test_updateLists_noChange_isUnchangedAndRecordsNothing', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  const out = await kit.clock.settle(updateLists(kit.ports, trust, DIR, () => undefined))
  expect(out.status).toBe('unchanged')
  expect(trust.digests).toHaveLength(0)
})

test('test_updateLists_groupHandle_roundTripsWithHash', async () => {
  const kit = createKit()
  const trust = memoryTrust()
  await kit.clock.settle(updateLists(kit.ports, trust, DIR, (l) => addEntry(l, 'allow', OPS)))
  expect((await readLists(kit.ports, trust, DIR)).lists.allow).toEqual([OPS])
})
