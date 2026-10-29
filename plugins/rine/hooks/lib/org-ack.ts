/** The one-time acknowledgement guarding the org tab Kept in the plugin's own `$.store`, never `$.state`, which any plugin reads. */
export const ORG_ACK_KEY = 'orgTabAck'

const ACKNOWLEDGED = { v: 1 } as const

export type OrgAckStore = {
  load: (key: string) => Promise<unknown>
  save: (key: string, value: unknown) => Promise<void>
}

/** A missing or malformed stored value counts as not acknowledged. */
export async function isOrgAcknowledged(store: OrgAckStore): Promise<boolean> {
  const kept = await store.load(ORG_ACK_KEY)
  return typeof kept === 'object' && kept !== null && (kept as { v?: unknown }).v === ACKNOWLEDGED.v
}

export function acknowledgeOrg(store: OrgAckStore): Promise<void> {
  return store.save(ORG_ACK_KEY, { ...ACKNOWLEDGED })
}
