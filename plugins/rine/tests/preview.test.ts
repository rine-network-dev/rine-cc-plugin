import { test, expect } from 'claude-code/testing'
import { createReader, loadPreview, parseRead, PREVIEW_MAX_CHARS, previewOf, READ_CONCURRENCY, READ_TIMEOUT_MS, verificationOf, type ReadPreview } from '../hooks/lib/preview'
import { DIR } from './entry-kit'
import { tick } from './tick'

const ID = 'aaaaaaaa-0001'
const read = (over: Record<string, unknown>): string => JSON.stringify({ verification_status: 'verified', from_agent_id: 'a-1', ...over })

test('test_parseRead_object_payload_text_is_taken', () => {
  const outcome = parseRead(read({ decrypted_payload: { text: 'hi' } }))
  expect(outcome).toEqual({ ok: true, message: { verificationStatus: 'verified', fromAgentId: 'a-1', text: 'hi', reason: null, cleartextNotice: null } })
})

test('test_parseRead_withheld_payload_keeps_the_decrypt_error', () => {
  const outcome = parseRead(read({ decrypted_payload: null, decrypt_error_code: 'NO_KEY' }))
  expect(outcome.ok && outcome.message.text).toBeNull()
  expect(outcome.ok && outcome.message.reason).toBe('NO_KEY')
})

test('test_parseRead_not_json_fails', () => {
  expect(parseRead('nope')).toEqual({ ok: false, reason: 'read printed no JSON' })
})

test('test_parseRead_array_fails', () => {
  expect(parseRead('[]').ok).toBe(false)
})

test('test_previewOf_strips_controls_and_counts_them', () => {
  const preview = previewOf(parseRead(read({ decrypted_payload: 'a\u001b[31mb\u200bc' })))
  expect(preview.status).toBe('ok')
  expect(preview.text).not.toContain('\u001b')
  expect(preview.hiddenChars).toBeGreaterThan(0)
  expect(preview.isVerified).toBe(true)
})

test('test_previewOf_long_text_is_cut_and_counted', () => {
  const preview = previewOf(parseRead(read({ decrypted_payload: 'x'.repeat(PREVIEW_MAX_CHARS + 50) })))
  expect(preview.truncatedChars).toBe(50)
})

test('test_previewOf_unverified_message_is_marked', () => {
  expect(previewOf(parseRead(read({ verification_status: 'invalid', decrypted_payload: 'x' }))).isVerified).toBe(false)
})

test('test_previewOf_a2a_cleartext_leads_with_the_notice_and_is_not_verified', () => {
  const notice = 'Received as A2A cleartext: this message was not end-to-end encrypted.'
  const preview = previewOf(
    parseRead(JSON.stringify({ from_agent_id: 'a-1', decrypted_payload: [{ text: 'hi' }], a2a_cleartext: true, a2a_cleartext_notice: notice }))
  )
  expect(preview).toMatchObject({ status: 'ok', isVerified: false })
  expect(preview.text?.startsWith(`[${notice}] `)).toBe(true)
})

test('test_previewOf_sealed_message_carries_no_notice', () => {
  expect(previewOf(parseRead(read({ decrypted_payload: 'hi', a2a_cleartext_notice: 'stray' }))).text).toBe('hi')
})

test('test_previewOf_withheld_payload_is_an_error_with_the_reason', () => {
  const preview = previewOf(parseRead(read({ decrypted_payload: null, decrypt_error: 'cannot decrypt' })))
  expect(preview).toMatchObject({ status: 'error', text: 'cannot decrypt' })
})

test('test_previewOf_failed_read_is_an_error', () => {
  expect(previewOf({ ok: false, reason: 'read failed (exit 1)' })).toEqual({ status: 'error', text: 'read failed (exit 1)' })
})

test('test_verificationOf_failed_read_is_empty', () => {
  expect(verificationOf({ ok: false, reason: 'x' })).toEqual({ status: null, fromAgentId: null })
})

test('test_reader_runs_read_with_timeout_and_config_dir', async () => {
  const seen: unknown[] = []
  const reader = createReader(async (argv, init) => {
    seen.push(argv, init)
    return { exitCode: 0, stdout: read({ decrypted_payload: 'x' }), stderr: '' }
  })
  expect((await reader.read(ID, DIR)).ok).toBe(true)
  expect(seen).toEqual([['rine', '--json', 'read', ID], { timeoutMs: READ_TIMEOUT_MS, env: { RINE_CONFIG_DIR: DIR } }])
})

test('test_reader_rejects_an_id_that_is_not_hex', async () => {
  let calls = 0
  const reader = createReader(async () => {
    calls += 1
    return { exitCode: 0, stdout: '{}', stderr: '' }
  })
  expect(await reader.read('--help', DIR)).toEqual({ ok: false, reason: 'message id is not readable' })
  expect(calls).toBe(0)
})

test('test_reader_rejects_an_option_like_id_with_a_leading_dash', async () => {
  let calls = 0
  const reader = createReader(async () => {
    calls += 1
    return { exitCode: 0, stdout: '{}', stderr: '' }
  })
  for (const id of ['--------', '-abcdef12', '-0000000-0']) expect(await reader.read(id, DIR)).toEqual({ ok: false, reason: 'message id is not readable' })
  expect(calls).toBe(0)
})

test('test_reader_nonzero_exit_fails', async () => {
  const reader = createReader(async () => ({ exitCode: 3, stdout: '', stderr: '' }))
  expect(await reader.read(ID, DIR)).toEqual({ ok: false, reason: 'read failed (exit 3)' })
})

test('test_reader_thrown_run_fails', async () => {
  const reader = createReader(async () => {
    throw new Error('timeout')
  })
  expect(await reader.read(ID, DIR)).toEqual({ ok: false, reason: 'read did not complete' })
})

test('test_reader_never_runs_more_than_the_concurrency_cap', async () => {
  let active = 0
  let peak = 0
  const gates: Array<() => void> = []
  const reader = createReader(async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => gates.push(resolve))
    active -= 1
    return { exitCode: 0, stdout: '{}', stderr: '' }
  })
  const all = Promise.all([1, 2, 3, 4].map(() => reader.read(ID, DIR)))
  for (let i = 0; i < 4; i++) {
    await tick()
    gates.splice(0).forEach((open) => open())
  }
  await all
  expect(peak).toBe(READ_CONCURRENCY)
})

test('test_loadPreview_sets_loading_then_the_result', async () => {
  const seen: ReadPreview[] = []
  const reader = createReader(async () => ({ exitCode: 0, stdout: read({ decrypted_payload: 'hi' }), stderr: '' }))
  const result = await loadPreview(reader, async (_id, preview) => void seen.push(preview), ID, DIR)
  expect(seen.map((p) => p.status)).toEqual(['loading', 'ok'])
  expect(result.text).toBe('hi')
})
