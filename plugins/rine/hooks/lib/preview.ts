import type { RinePreview } from '../../types/index'
import { isRecord, stringOrNull } from './narrow'
import type { RunPort } from './ports'
import { safeBlock, safeLine } from './sanitize'
import type { Verification } from './router'

export const READ_TIMEOUT_MS = 10000
export const READ_CONCURRENCY = 2
export const PREVIEW_MAX_CHARS = 2000

const MESSAGE_ID = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/
const REASON_CELLS = 120

/** The plaintext stays in this value only long enough to become a `RinePreview`; nothing stores it. */
export type ReadMessage = { verificationStatus: string | null; fromAgentId: string | null; text: string | null; reason: string | null }
export type ReadOutcome = { ok: true; message: ReadMessage } | { ok: false; reason: string }
export type Reader = { read: (id: string, configDir: string) => Promise<ReadOutcome> }
export type PreviewSetter = (id: string, preview: RinePreview) => Promise<void>

export function payloadText(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null
  if (typeof payload === 'string') return payload
  if (isRecord(payload) && typeof payload.text === 'string') return payload.text
  return JSON.stringify(payload)
}

export function parseRead(stdout: string): ReadOutcome {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: 'read printed no JSON' }
  }
  if (!isRecord(data)) return { ok: false, reason: 'read printed an unexpected shape' }
  return {
    ok: true,
    message: {
      verificationStatus: stringOrNull(data.verification_status),
      fromAgentId: stringOrNull(data.from_agent_id),
      text: payloadText(data.decrypted_payload),
      reason: stringOrNull(data.decrypt_error) ?? stringOrNull(data.decrypt_error_code)
    }
  }
}

/** `rine --json read <id>` with at most READ_CONCURRENCY reads in flight; `limitRuns` caps the rate on top. */
export function createReader(run: RunPort): Reader {
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    while (active >= READ_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
    active += 1
  }
  const release = (): void => {
    active -= 1
    waiting.shift()?.()
  }
  return {
    read: async (id, configDir) => {
      if (!MESSAGE_ID.test(id)) return { ok: false, reason: 'message id is not readable' }
      await acquire()
      try {
        const result = await run(['rine', '--json', 'read', id], {
          timeoutMs: READ_TIMEOUT_MS,
          env: { RINE_CONFIG_DIR: configDir }
        })
        if (result.exitCode !== 0) return { ok: false, reason: `read failed (exit ${result.exitCode})` }
        return parseRead(result.stdout)
      } catch {
        return { ok: false, reason: 'read did not complete' }
      } finally {
        release()
      }
    }
  }
}

export function verificationOf(outcome: ReadOutcome): Verification {
  if (!outcome.ok) return { status: null, fromAgentId: null }
  return { status: outcome.message.verificationStatus, fromAgentId: outcome.message.fromAgentId }
}

/** The sanitised preview: at most PREVIEW_MAX_CHARS characters, with the removed and cut counts. */
export function previewOf(outcome: ReadOutcome): RinePreview {
  if (!outcome.ok) return { status: 'error', text: safeLine(outcome.reason, REASON_CELLS) }
  const { text, verificationStatus, reason } = outcome.message
  const isVerified = verificationStatus === 'verified'
  if (text === null) {
    return { status: 'error', isVerified, text: safeLine(reason ?? 'content not available', REASON_CELLS) }
  }
  const block = safeBlock(text, PREVIEW_MAX_CHARS)
  return { status: 'ok', text: block.text, isVerified, hiddenChars: block.hiddenChars, truncatedChars: block.truncatedChars }
}

export async function loadPreview(reader: Reader, set: PreviewSetter, id: string, configDir: string): Promise<RinePreview> {
  await set(id, { status: 'loading' })
  const preview = previewOf(await reader.read(id, configDir))
  await set(id, preview)
  return preview
}
