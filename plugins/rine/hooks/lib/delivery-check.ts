import type { RineEntry } from '../../types/index'
import type { DeliveryStore, DeliveryView } from './delivery-core'
import { isWakeAllowed, type Lease } from './lease'
import { matchLists, type Sender } from './lists'
import type { Ports } from './ports'
import { verificationOf, type Reader } from './preview'
import { gateWake, type Downgrade, type Intent, type Verification, type WakeDisposition } from './router'

export type Candidate = { entry: RineEntry; sender: Sender; intent: Intent; isInbound: boolean }

type CheckDeps = { ports: Pick<Ports, 'clock'>; store: DeliveryStore; reader: Reader; lease: Pick<Lease, 'wakes'> }

export type Checker = {
  /** The arrival-time gate, reading the message when the gate asks to verify it. */
  check: (c: Candidate) => Promise<Downgrade | null>
  /** The same gate over the live view and the answer `check` got, for the moment just before a submit. */
  recheck: (c: Candidate) => Promise<Downgrade | null>
}

const reasonOf = (verdict: WakeDisposition): Downgrade | null =>
  verdict.kind === 'wake' ? null : verdict.kind === 'notify' ? verdict.reason : 'unverified'

export function createChecker({ ports, store, reader, lease }: CheckDeps): Checker {
  const verified = new WeakMap<Candidate, Verification>()

  const gate = async (c: Candidate, view: DeliveryView, verification: Verification | null) => {
    const now = await ports.clock.now()
    return gateWake(c.intent, {
      list: matchLists(view.lists.lists, c.sender).list,
      isMuted: view.isMuted,
      isPreview: view.isPreview,
      isOwner: view.isOwner,
      isInteractive: view.mode === 'ready',
      isStateWritable: view.identity.isStateWritable,
      isListsTrusted: view.lists.isTrusted,
      permissionMode: view.permissionMode,
      isInbound: c.isInbound,
      isPending: view.pendingWake,
      cooldownUntil: view.wakeCooldownUntil,
      now,
      isRateAllowed: isWakeAllowed(lease.wakes(), now),
      fromAgentId: c.entry.fromAgentId,
      ownAgentId: view.identity.agentId,
      verification
    })
  }

  return {
    check: async (c) => {
      const view = await store.read()
      let verdict = await gate(c, view, null)
      if (verdict.kind === 'verify') {
        const verification = verificationOf(await reader.read(c.entry.id, view.identity.configDir))
        verified.set(c, verification)
        verdict = await gate(c, await store.read(), verification)
      }
      return reasonOf(verdict)
    },
    recheck: async (c) => reasonOf(await gate(c, await store.read(), verified.get(c) ?? null))
  }
}
