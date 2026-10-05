import type { RineEntry } from '../types/index'

export const DIR = '/rine'

export function makeEntry(over: Partial<RineEntry> = {}): RineEntry {
  return {
    id: 'm-1',
    from: 'bob@acme.rine.network',
    fromAgentId: 'agent-bob',
    group: null,
    groupId: null,
    type: 'rine.v1.dm',
    conversationId: null,
    encryption: 'hpke-v1',
    createdAt: '2026-10-02T10:00:00Z',
    receivedAt: 1_000_000,
    list: 'none',
    disposition: 'notified',
    state: 'unread',
    rowIndex: null,
    isWebhook: false,
    ...over
  }
}
