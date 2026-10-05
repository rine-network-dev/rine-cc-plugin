import type { RineEntry, RinePreview } from '../types/index'
import { createDelivery, type Delivery } from '../hooks/lib/delivery'
import type { DeliveryStore, DeliveryView } from '../hooks/lib/delivery-core'
import type { StreamMessage } from '../hooks/lib/frames'
import type { Lease } from '../hooks/lib/lease'
import type { Sender } from '../hooks/lib/lists'
import { DIR } from './entry-kit'
import { createKit, type Kit } from './kit'

export const OWN = 'agent-own'
export const READ_OK = JSON.stringify({ verification_status: 'verified', from_agent_id: 'agent-bob', decrypted_payload: { text: 'hello' } })

export type Rig = {
  kit: Kit
  view: DeliveryView
  previews: Map<string, RinePreview>
  pinned: Sender[]
  woke: number[]
  changes: { count: number }
  lease: Pick<Lease, 'isStillOwner' | 'wakes' | 'recordWake'> & { wakeLog: number[]; isOwner: boolean }
  delivery: Delivery
  carried: Set<string>
  logs: string[]
}

export function makeView(over: Partial<DeliveryView> = {}): DeliveryView {
  return {
    entries: [],
    mode: 'ready',
    identity: { handle: 'me@acme.rine.network', agentId: OWN, configDir: DIR, cliVersion: '1.0.0', isBelowFloor: false, isStateWritable: true },
    lists: { lists: { allow: [], deny: [] }, digest: null, isTrusted: true },
    isPreview: false,
    isMuted: false,
    isOwner: true,
    isBusy: false,
    pendingWake: false,
    wakeCooldownUntil: null,
    permissionMode: 'default',
    ...over
  }
}

export function message(over: Partial<StreamMessage> = {}): StreamMessage {
  return {
    id: 'aaaaaaaa-0001',
    fromAgentId: 'agent-bob',
    senderHandle: 'bob@acme.rine.network',
    type: 'rine.v1.dm',
    direction: 'received',
    conversationId: null,
    encryption: 'hpke-v1',
    createdAt: '2026-10-02T10:00:00Z',
    groupId: null,
    groupHandle: null,
    ...over
  }
}

export const ALLOW_BOB = { allow: [{ kind: 'agent' as const, handle: 'bob@acme.rine.network', agentId: null }], deny: [] }

export function createRig(over: Partial<DeliveryView> = {}): Rig {
  const kit = createKit()
  kit.setRun(() => ({ exitCode: 0, stdout: READ_OK, stderr: '' }))
  const rig = { kit, view: makeView(over), previews: new Map<string, RinePreview>(), pinned: [] as Sender[], woke: [] as number[] } as Rig
  rig.changes = { count: 0 }
  rig.carried = new Set()
  rig.logs = []
  rig.lease = {
    isOwner: true,
    wakeLog: [],
    isStillOwner: async () => rig.lease.isOwner,
    wakes: () => rig.lease.wakeLog,
    recordWake: async (at) => {
      rig.lease.wakeLog.push(at)
    }
  }
  const store: DeliveryStore = {
    read: async () => rig.view,
    updateEntries: async (edit: (entries: readonly RineEntry[]) => RineEntry[]) => {
      rig.view = { ...rig.view, entries: edit(rig.view.entries) }
    },
    patch: async (changes) => {
      rig.view = { ...rig.view, ...changes }
    },
    setPreview: async (id, preview) => {
      rig.previews.set(id, preview)
    }
  }
  rig.delivery = createDelivery({
    ports: kit.ports,
    store,
    lease: rig.lease,
    carried: () => rig.carried,
    changed: () => {
      rig.changes.count += 1
    },
    pinSender: async (sender) => {
      rig.pinned.push(sender)
    },
    onWoke: (at) => {
      rig.woke.push(at)
    },
    log: (text) => rig.logs.push(text)
  })
  return rig
}

/** Lets detached work (wake drain, toast batch window) run to the end. */
export async function settle(rig: Rig, ms = 4000): Promise<void> {
  for (let i = 0; i < 3; i++) await rig.kit.clock.advance(ms)
}

export function allowedRig(): Rig {
  return createRig({ lists: { lists: ALLOW_BOB, digest: null, isTrusted: true } })
}

export async function receive(rig: Rig, id = 'aaaaaaaa-0001'): Promise<void> {
  await rig.delivery.onMessage(message({ id }), false)
  await settle(rig)
}
