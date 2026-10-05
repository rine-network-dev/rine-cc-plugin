import { test, expect } from 'claude-code/testing'
import { digestHex, open, readSealed, seal, updateSealed, writeSealed } from '../hooks/lib/envelope'
import { createKit, splice, truncated } from './kit'

const PATH = '/state/cc/ledger.json'

test('test_seal_roundtrip_returnsBody', async () => {
  const body = '{"a":1}'
  expect(await open(await seal(body))).toBe(body)
})

test('test_digestHex_knownInput_matchesSha256', async () => {
  expect(await digestHex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('test_open_splicedSameShapeBody_returnsNull', async () => {
  const sealedA = await seal('{"nonce":"aaaaaaaa","n":1}')
  const sealedB = await seal('{"nonce":"bbbbbbbb","n":2}')
  const cut = 65 + 13
  const spliced = sealedA.slice(0, cut) + sealedB.slice(cut)
  expect(await open(spliced)).toBeNull()
})

test('test_open_shortRead_returnsNull', async () => {
  const sealed = await seal('{"a":1}')
  expect(await open(sealed.slice(0, Math.floor(sealed.length / 2)))).toBeNull()
})

test('test_open_noNewline_returnsNull', async () => {
  expect(await open('0123456789abcdef')).toBeNull()
})

test('test_open_tamperedBody_returnsNull', async () => {
  const sealed = await seal('{"a":1}')
  const tampered = sealed.slice(0, -1) + '2'
  expect(await open(tampered)).toBeNull()
})

test('test_seal_headerIsBodyDigest', async () => {
  const body = '{"a":1}'
  const sealed = await seal(body)
  expect(sealed.slice(0, sealed.indexOf('\n'))).toBe(await digestHex(body))
})

test('test_readSealed_absentFile_isAbsent', async () => {
  expect(await readSealed(createKit().ports, PATH)).toEqual({ status: 'absent' })
})

test('test_readSealed_valid_isOkWithParsedValue', async () => {
  const kit = createKit()
  await writeSealed(kit.ports, PATH, { a: 1 })
  expect(await readSealed(kit.ports, PATH)).toEqual({ status: 'ok', body: '{"a":1}', value: { a: 1 } })
})

test('test_readSealed_tornThenGood_retriesOnceAfter100ms', async () => {
  const kit = createKit()
  await writeSealed(kit.ports, PATH, { a: 1 })
  kit.fs.injectReads(PATH, [truncated(kit.fs.files.get(PATH) ?? '')])
  const before = await kit.clock.now()
  const outcome = await kit.clock.settle(readSealed(kit.ports, PATH))
  expect(outcome.status).toBe('ok')
  expect((await kit.clock.now()) - before).toBeGreaterThanOrEqual(100)
})

test('test_readSealed_splicedTwice_isUnknown', async () => {
  const kit = createKit()
  const spliced = splice(await seal('{"n":1,"x":"aaaa"}'), await seal('{"n":2,"x":"bbbb"}'))
  kit.fs.injectReads(PATH, [spliced, spliced])
  expect((await kit.clock.settle(readSealed(kit.ports, PATH))).status).toBe('unknown')
})

test('test_readSealed_garbageContent_isUnknown', async () => {
  const kit = createKit()
  kit.fs.files.set(PATH, 'hello')
  expect((await kit.clock.settle(readSealed(kit.ports, PATH))).status).toBe('unknown')
})

test('test_readSealed_validEnvelopeInvalidJson_isUnknown', async () => {
  const kit = createKit()
  kit.fs.files.set(PATH, await seal('not json'))
  expect((await kit.clock.settle(readSealed(kit.ports, PATH))).status).toBe('unknown')
})

test('test_writeSealed_returnsBodyAndStoresSealedText', async () => {
  const kit = createKit()
  const body = await writeSealed(kit.ports, PATH, { b: 2 })
  expect(body).toBe('{"b":2}')
  expect(kit.fs.files.get(PATH)).toBe(await seal(body))
})

test('test_writeSealed_writeFailure_rejects', async () => {
  const kit = createKit()
  kit.fs.isWriteFailing = true
  await expect(writeSealed(kit.ports, PATH, { b: 2 })).rejects.toThrow()
})

test('test_updateSealed_absentFile_writesThenReadsBackAfter200ms', async () => {
  const kit = createKit()
  const seen: string[] = []
  const before = await kit.clock.now()
  const outcome = await kit.clock.settle(
    updateSealed(kit.ports, PATH, (current) => {
      seen.push(current.status)
      return { n: 1 }
    })
  )
  expect(outcome).toEqual({ status: 'ok', value: { n: 1 } })
  expect(seen).toEqual(['absent'])
  expect((await kit.clock.now()) - before).toBeGreaterThanOrEqual(200)
})

test('test_updateSealed_editAnswersUndefined_isUnchangedAndWritesNothing', async () => {
  const kit = createKit()
  const outcome = await kit.clock.settle(updateSealed(kit.ports, PATH, () => undefined))
  expect(outcome).toEqual({ status: 'unchanged' })
  expect(kit.fs.files.size).toBe(0)
})

test('test_updateSealed_firstReadBackMismatch_retriesOnce', async () => {
  const kit = createKit()
  kit.fs.injectReads(PATH, [await seal('{"n":1}'), await seal('{"n":999}')])
  let edits = 0
  const outcome = await kit.clock.settle(updateSealed(kit.ports, PATH, () => ({ n: ++edits })))
  expect(outcome.status).toBe('ok')
  expect(edits).toBe(2)
})

test('test_updateSealed_readBackAlwaysDiffers_isFailedAfterOneRetry', async () => {
  const kit = createKit()
  const [a, b] = [await seal('{"n":1}'), await seal('{"n":2}')]
  kit.fs.injectReads(PATH, [a, b, a, b])
  const outcome = await kit.clock.settle(updateSealed(kit.ports, PATH, () => ({ n: 3 })))
  expect(outcome).toEqual({ status: 'failed' })
})

test('test_updateSealed_writeThrows_isFailed', async () => {
  const kit = createKit()
  kit.fs.isWriteFailing = true
  expect(await kit.clock.settle(updateSealed(kit.ports, PATH, () => ({ n: 1 })))).toEqual({ status: 'failed' })
})
