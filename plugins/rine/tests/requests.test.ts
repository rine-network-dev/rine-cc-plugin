import { test, expect } from 'claude-code/testing'
import { seal } from '../hooks/lib/envelope'
import { pendingRequests, readRequests, REQUESTS_CAP, submitRequest } from '../hooks/lib/requests'
import { statePath } from '../hooks/lib/refs'
import { at } from './at'
import { DIR } from './entry-kit'
import { createKit } from './kit'

const PATH = statePath(DIR, 'requests')

test('test_readRequests_absentFile_isEmpty', async () => {
  expect(await readRequests(createKit().ports, DIR)).toEqual([])
})

test('test_submitRequest_writesTheRequestAndReadsItBack', async () => {
  const kit = createKit()
  const request = await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-1', []))
  expect(request).toMatchObject({ kind: 'read', entryId: 'm-1' })
  expect(await readRequests(kit.ports, DIR)).toEqual([request])
})

test('test_submitRequest_secondActor_keepsTheFirstRequest', async () => {
  const kit = createKit()
  const first = await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-1', []))
  const second = await kit.clock.settle(submitRequest(kit.ports, DIR, 'handed', 'm-2', []))
  expect((await readRequests(kit.ports, DIR)).map((r) => r.id)).toEqual([first?.id, second?.id])
})

test('test_submitRequest_appliedRequests_arePruned', async () => {
  const kit = createKit()
  const first = await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-1', []))
  await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-2', [first?.id ?? '']))
  expect((await readRequests(kit.ports, DIR)).map((r) => r.entryId)).toEqual(['m-2'])
})

test('test_submitRequest_overTheCap_keepsTheNewest', async () => {
  const kit = createKit()
  const many = Array.from({ length: REQUESTS_CAP }, (_, i) => ({ id: `r${i}`, kind: 'read', entryId: `m${i}`, at: i }))
  kit.fs.files.set(PATH, await seal(JSON.stringify({ v: 1, requests: many })))
  const request = await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-new', []))
  const stored = await readRequests(kit.ports, DIR)
  expect(stored).toHaveLength(REQUESTS_CAP)
  expect(at(stored, stored.length - 1).id).toBe(request?.id)
  expect(at(stored, 0).id).toBe('r1')
})

test('test_submitRequest_writeFails_isNull', async () => {
  const kit = createKit()
  kit.fs.isWriteFailing = true
  expect(await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-1', []))).toBeNull()
})

test('test_submitRequest_clobberedByPeer_retriesOnce', async () => {
  const kit = createKit()
  await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-0', []))
  const empty = await seal(JSON.stringify({ v: 1, requests: [] }))
  kit.fs.injectReads(PATH, [kit.fs.files.get(PATH) ?? '', empty])
  const request = await kit.clock.settle(submitRequest(kit.ports, DIR, 'read', 'm-1', []))
  expect(request).not.toBeNull()
  expect((await readRequests(kit.ports, DIR)).some((r) => r.id === request?.id)).toBe(true)
})

test('test_readRequests_tornFile_readsAsNone', async () => {
  const kit = createKit()
  kit.fs.files.set(PATH, 'abc\n{"v":1')
  expect(await kit.clock.settle(readRequests(kit.ports, DIR))).toEqual([])
})

test('test_pendingRequests_excludesApplied', () => {
  const requests = [
    { id: 'a', kind: 'read' as const, entryId: 'x', at: 1 },
    { id: 'b', kind: 'read' as const, entryId: 'y', at: 2 }
  ]
  expect(pendingRequests(requests, ['a']).map((r) => r.id)).toEqual(['b'])
})
