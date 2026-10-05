import { applyRequests, counts, mirrorLedger } from '../lib/ledger'
import { loadLedger } from '../lib/ledger-file'
import { readLists } from '../lib/lists'
import { hasLegacyPause, isMuted, readPrefs } from '../lib/prefs'
import { pendingRequests, readRequests } from '../lib/requests'
import { statusText } from '../lib/status'
import { UNTRUSTED_TOAST, type Core, type Live } from './core'
import type { Mem } from './memory'

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Takes in a prefs, lists or pause change another session (or the person's editor) made; unchanged values write nothing. */
async function refreshFiles(core: Core, live: Live): Promise<void> {
  const { ports, mem } = core
  const m = mem.get()
  const patch: Partial<Mem> = {}
  const prefs = await readPrefs(ports, live.rineDir, m.prefs)
  const lists = await readLists(ports, live.trust, live.rineDir, m.lists)
  const isLegacyPaused = await hasLegacyPause(ports, live.rineDir)
  if (!same(prefs, m.prefs)) patch.prefs = prefs
  if (lists.digest !== m.lists.digest || lists.isTrusted !== m.lists.isTrusted) patch.lists = lists
  if (isLegacyPaused !== m.isLegacyPaused) patch.isLegacyPaused = isLegacyPaused
  if (m.lists.isTrusted && !lists.isTrusted) core.host.backend.toast(UNTRUSTED_TOAST)
  if (Object.keys(patch).length > 0) mem.set(patch)
}

/** The owner applies what non-owners asked for. */
async function applyAsked(core: Core, live: Live): Promise<void> {
  const { ports, mem } = core
  const requests = await readRequests(ports, live.rineDir)
  const m = mem.get()
  if (pendingRequests(requests, m.appliedRequests).length === 0) return
  const next = applyRequests(m.entries, requests, m.appliedRequests)
  mem.set({ entries: next.entries, appliedRequests: next.applied })
  live.changed()
}

/** A non-owner follows the owner's ledger and announces what it has not seen since `mirrorSince`. */
async function mirror(core: Core, live: Live): Promise<void> {
  const { ports, mem } = core
  const m = mem.get()
  const mirrored = mirrorLedger(m.entries, await loadLedger(ports, live.rineDir), m.mirrorSince)
  if (!same(mirrored.entries, m.entries)) mem.set({ entries: mirrored.entries })
  if (mirrored.fresh.length > 0) await live.delivery.announce(mirrored.fresh)
}

/** The 5 s step: status first, so a dead stream visibly ages, then the file work for this session's role. */
export async function tick(core: Core): Promise<void> {
  const now = await core.ports.clock.now()
  const m = core.mem.get()
  const { unread, held } = counts(m.entries)
  core.host.status(
    statusText({
      isDetecting: m.isDetecting,
      mode: m.mode,
      identity: m.identity,
      stream: m.stream,
      isMuted: isMuted(m.prefs, now, m.isLegacyPaused),
      isPreview: m.prefs.isPreview,
      unread,
      held,
      now,
      wokeAt: m.wokeAt
    })
  )
  const live = core.live()
  if (live === null) return
  await refreshFiles(core, live)
  if (!m.identity.isStateWritable) return
  await (m.isOwner ? applyAsked(core, live) : mirror(core, live))
}
