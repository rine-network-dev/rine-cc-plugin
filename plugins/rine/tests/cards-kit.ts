import { NOW } from './ui-kit'

export const toolName = (name: string): string => `mcp__plugin_rine_rine__${name}`

/** What rine-mcp's server returns for a tool: one text block holding JSON.stringify(result, null, 2). */
export function blocks(result: unknown): { content: { type: 'text'; text: string }[]; isError: false } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false }
}

/** A MessageRead as `rine_inbox`/`rine_read` hand it back, opened: sender, verdict, decrypted body. */
export function messageRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-1',
    conversation_id: 'c-1',
    sender_handle: 'bob@acme.rine.network',
    from_agent_id: 'agent-bob',
    to_agent_id: 'agent-own',
    type: 'rine.v1.dm',
    encrypted_payload: 'eyJhbGciOiJIUEtFIn0',
    direction: 'received',
    encryption_version: 'hpke-hybrid-v2',
    content_type: 'application/json',
    created_at: new Date(NOW - 120_000).toISOString(),
    status: 'new',
    verified: true,
    verification_status: 'verified',
    decrypted: { text: 'Can you rebase the branch?' },
    ...over
  }
}

export function inboxOutput(rows: Record<string, unknown>[]): ReturnType<typeof blocks> {
  return blocks({ items: rows, total: rows.length })
}

export function readOutput(over: Record<string, unknown> = {}): ReturnType<typeof blocks> {
  return blocks(messageRow(over))
}

/** A DirectoryAgentSummary as `rine_discover` returns it. */
export function directoryRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    handle: 'ada@acme.rine.network',
    name: 'Ada Review Bot',
    short_description: 'Reviews pull requests',
    org_name: 'Acme',
    trust_tier: 2,
    skills_summary: ['code-review'],
    tags: [],
    categories: ['dev'],
    jurisdiction: 'EU',
    languages: ['en'],
    pricing_model: 'free',
    accepts_payments: false,
    human_oversight: true,
    relevance_score: 0.9,
    card_url: 'https://rine.network/.well-known/agent-cards/a-1.json',
    is_public: true,
    created_at: '2026-09-01T00:00:00Z',
    ...over
  }
}

export function discoverOutput(rows: Record<string, unknown>[]): ReturnType<typeof blocks> {
  return blocks({
    schema_version: '2.0',
    items: rows,
    total_estimate: rows.length,
    has_more: false,
    next_cursor: null,
    search_mode: ['keyword']
  })
}
