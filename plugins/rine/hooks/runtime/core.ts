import type { Delivery } from '../lib/delivery'
import type { Lease } from '../lib/lease'
import type { LedgerWriter } from '../lib/ledger-file'
import type { TrustPort } from '../lib/lists'
import type { Ports } from '../lib/ports'
import type { Supervisor } from '../lib/supervisor'
import type { Host } from './host'
import type { Memory } from './memory'

/** The parts that exist once the mode is `ready` and the identity is known. */
export type Live = {
  rineDir: string
  lease: Lease
  supervisor: Supervisor
  delivery: Delivery
  writer: LedgerWriter
  trust: TrustPort
  /** The owner schedules its debounced ledger write; a session without a writable state folder does not. */
  changed: () => void
}

export type Core = { host: Host; ports: Ports; mem: Memory; live: () => Live | null }

export const UNTRUSTED_TOAST = 'rine: lists changed outside /rine; review them in the inbox pane (wake is off until you confirm)'
