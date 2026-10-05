export function lifecycleLine(state: string): string {
  return JSON.stringify({ event: 'lifecycle', data: { state, attempt: 1 } }) + '\n'
}

export function heartbeatLine(): string {
  return JSON.stringify({ event: 'heartbeat', data: JSON.stringify({ timestamp: 1 }) }) + '\n'
}

export function messageLine(over: Record<string, unknown> = {}): string {
  const data = {
    id: 'm-1',
    from_agent_id: 'agent-b',
    sender_handle: 'bob@acme.rine.network',
    type: 'rine.v1.dm',
    direction: 'received',
    conversation_id: 'c-1',
    encryption_version: 'hpke-v1',
    created_at: '2026-10-02T10:00:00Z',
    group_id: null,
    group_handle: null,
    ...over
  }
  return JSON.stringify({ event: 'message', id: data.id, data: JSON.stringify(data) }) + '\n'
}
