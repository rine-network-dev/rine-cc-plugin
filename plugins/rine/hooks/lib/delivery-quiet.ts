import type { RineEntry } from '../../types/index'
import type { Candidate, WakeDeps } from './delivery-wake'
import { arrivalToast, SUFFIX } from './delivery-toast'
import { patchEntries } from './ledger'
import { loadPreview } from './preview'

export type QuietReason = 'denied' | 'muted' | 'preview'

const QUIET: Record<QuietReason, Partial<RineEntry>> = {
  denied: { disposition: 'silent', list: 'deny' },
  muted: { disposition: 'silent' },
  preview: { disposition: 'held' }
}

/** A deny, mute or preview made after arrival files the entry the way `route` would have, with no notify row. */
export async function settleQuietly(
  deps: Pick<WakeDeps, 'store' | 'reader' | 'say' | 'changed' | 'log'>, c: Candidate, reason: QuietReason
): Promise<void> {
  const { store } = deps
  await store.updateEntries((entries) => patchEntries(entries, [c.entry.id], QUIET[reason]))
  deps.changed()
  if (reason !== 'preview') return
  deps.say(c.entry, arrivalToast(c.entry, SUFFIX.held))
  const { identity } = await store.read()
  if (identity.isStateWritable) void loadPreview(deps.reader, store.setPreview, c.entry.id, identity.configDir).catch(() => deps.log('rine: preview failed'))
}
