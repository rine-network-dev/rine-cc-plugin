import type { RineIdentity } from '../../types/index'
import { createDelivery } from '../lib/delivery'
import { createLease, newNonce } from '../lib/lease'
import { createLedgerWriter, loadLedger } from '../lib/ledger-file'
import { adoptMerged, mergeEntries } from '../lib/ledger'
import { pinIds, readLists, updateLists, type TrustPort } from '../lib/lists'
import { hasLegacyPause, isMuted, readPrefs } from '../lib/prefs'
import { createSupervisor } from '../lib/supervisor'
import { UNTRUSTED_TOAST, type Core, type Live } from './core'

/** The trust record is keyed by agent and by the folder's real path, outside every project tree. */
async function trustFor(core: Core, agentId: string, dir: string): Promise<TrustPort> {
  const key = `lists-trust:${agentId}:${(await core.host.realPath(dir)) ?? dir}`
  return { load: () => core.host.loadDigests(key), save: (digests) => core.host.saveDigests(key, digests) }
}

/** Loads what the files hold, then wires the lease, ledger writer, delivery and supervisor over one folder. */
export async function buildLive(core: Core, identity: RineIdentity, agentId: string, cwd: string): Promise<Live> {
  const { host, ports, mem } = core
  const dir = identity.configDir
  const trust = await trustFor(core, agentId, dir)
  const before = mem.get()
  const [prefs, lists, ledger, isLegacyPaused] = await Promise.all([
    readPrefs(ports, dir, before.prefs),
    readLists(ports, trust, dir),
    loadLedger(ports, dir),
    hasLegacyPause(ports, dir)
  ])
  const nonce = before.leaseNonce ?? newNonce(ports.random)
  mem.set({
    prefs,
    lists,
    isLegacyPaused,
    leaseNonce: nonce,
    entries: mergeEntries(ledger.entries, before.entries),
    appliedRequests: ledger.appliedRequests
  })
  if (!lists.isTrusted) host.backend.toast(UNTRUSTED_TOAST)

  const lease = createLease(ports, { rineDir: dir, nonce, agentId, sessionId: await host.sessionId(), cwd })
  const carried = new Set(ledger.entries.map((entry) => entry.id))
  const writer = createLedgerWriter(ports, dir, {
    snapshot: () => ({ v: 1, entries: mem.get().entries, appliedRequests: mem.get().appliedRequests }),
    onMerged: (merged, droppedHeld, written) => {
      mem.set({ entries: adoptMerged(mem.get().entries, written.entries, merged.entries) })
      if (droppedHeld > 0) host.backend.toast(`rine: ${droppedHeld} held messages dropped (cap)`)
    },
    onError: () => host.backend.log('rine: ledger write failed')
  })
  const changed = (): void => {
    if (mem.get().isOwner && identity.isStateWritable) writer.schedule()
  }
  const delivery = createDelivery({
    ports,
    store: {
      read: async () => {
        const m = mem.get()
        return { ...m, isPreview: m.prefs.isPreview, isMuted: isMuted(m.prefs, await ports.clock.now(), m.isLegacyPaused) }
      },
      updateEntries: async (edit) => mem.set({ entries: edit(mem.get().entries) }),
      patch: async (flags) => mem.set(flags),
      setPreview: host.setPreview
    },
    lease,
    carried: () => carried,
    changed,
    pinSender: async (sender) => {
      await updateLists(ports, trust, dir, (all, isTrusted) => (isTrusted ? pinIds(all, sender) : undefined), mem.get().lists)
      mem.set({ lists: await readLists(ports, trust, dir, mem.get().lists) })
    },
    onWoke: (at) => mem.set({ wokeAt: at }),
    log: host.backend.log
  })
  const supervisor = createSupervisor(
    ports,
    {
      spawn: host.spawn,
      after: host.after,
      publish: (stream) => mem.set({ stream }),
      emit: (event) => {
        const job = event.kind === 'message' ? delivery.onMessage(event.message, event.isBacklog) : delivery.onSettled()
        void job.catch(() => host.backend.log('rine: delivery failed'))
      },
      log: host.backend.log
    },
    dir
  )
  return { rineDir: dir, lease, supervisor, delivery, writer, trust, changed }
}
