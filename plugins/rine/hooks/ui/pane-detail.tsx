import type { Register } from 'claude-code'
import { read, update } from 'claude-code'
import type { RineEntry, RineIdentity, RineLists, RinePhase, RinePreview } from '../../types/index'
import { MCP_SERVER } from '../lib/refs'
import { safeLine, scrubNotes } from '../lib/sanitize'
import type { Ui } from './pane-rows'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const focusRef = { plugin: 'rine', key: 'focusId' } as const
const draftRef = { plugin: 'rine', key: 'replyDraft' } as const

const PHASES: Record<RinePhase, string> = {
  off: '○ off',
  connecting: '◌ connecting',
  live: '● live',
  stale: '⚠ no signal',
  backoff: '◌ reconnecting',
  offline: '✕ offline',
  'auth-failed': '✕ auth failed',
  peer: '⇄ another session owns it'
}

export type Header = { identity: RineIdentity; phase: RinePhase; isPreview: boolean; isMuted: boolean; isOwner: boolean }

export function headerLine(h: Header, columns: number): string {
  const handle = h.identity.handle === null ? 'identity unknown' : safeLine(h.identity.handle, 40)
  const parts = [handle, PHASES[h.phase], `preview ${h.isPreview ? 'on' : 'off'}`, h.isMuted ? 'muted' : 'not muted', h.isOwner ? 'owner' : 'not owner']
  return safeLine(parts.join(' · '), columns)
}

/** What the untrusted-lists banner asks the person to review: every entry of both lists, one per line, as the file holds them now. */
export function listLines(lists: RineLists, columns: number): string[] {
  const lines = (name: string, entries: RineLists['allow']): string[] =>
    entries.length === 0
      ? [`${name}: none`]
      : entries.map((entry) => safeLine(`${name}: ${entry.handle}${entry.agentId === null ? '' : ` (${entry.agentId})`}`, columns))
  return [...lines('allow', lists.allow), ...lines('deny', lists.deny)]
}

/** The focused entry's text, as `preview.ts` scrubbed and capped it; nothing here ever sees a raw body. */
export function detailTree(ui: Ui, preview: RinePreview | undefined, columns: number) {
  const { Box, Text } = ui
  if (preview === undefined) return <Text dimColor>Press r to read the focused message.</Text>
  if (preview.status === 'loading') return <Text dimColor>decrypting…</Text>
  if (preview.status === 'error') return <Text dimColor>Could not read this message.</Text>
  const notes = scrubNotes(preview.truncatedChars, preview.hiddenChars)
  return (
    <Box key="detail" flexDirection="column">
      <Text dimColor>{preview.isVerified ? 'verified ✓' : 'not verified ✗'}</Text>
      <Text>{preview.text ?? ''}</Text>
      {notes.map((note) => (
        <Text dimColor>{safeLine(note, columns)}</Text>
      ))}
    </Box>
  )
}

function oneToOne(entries: readonly RineEntry[] | undefined, id: string | null | undefined): RineEntry | undefined {
  return entries?.find((entry) => entry.id === id && entry.group === null)
}

/** The reply pane holds the one Input: a focused Input swallows every letter, Button hotkeys included. */
export const registerReply = (on: Parameters<Register>[0]): void => {
  on('ui.render', { component: 'Pane', requestId: 'rine-reply' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.surface === 'mobile') return <Text>This surface cannot take typed text: reply from the terminal.</Text>
    const { Input } = $.ui.resolve(e)
    const id = await read($, focusRef)
    const entry = oneToOne(await read($, entriesRef), id)
    if (entry === undefined || id === null || id === undefined) return <Text>Nothing to reply to.</Text>
    const draft = (await read($, { ...draftRef, id })) ?? ''
    const say = (text: string): void => $.ui.toast(`rine: ${text}`)

    const send = async (text: string): Promise<void> => {
      if (text.trim() === '') return
      const outcome = await $.mcp.call(MCP_SERVER, 'rine_reply', { message_id: entry.id, payload: { text } }).catch(() => null)
      if (outcome === null || outcome.isError === true) return say('reply not sent, try again')
      await update($, { ...draftRef, id }, () => '')
      await $.ui.close({ id: 'rine-reply' })
      say('reply sent')
    }

    return (
      <Box flexDirection="column">
        <Text>{safeLine(`Reply to ${safeLine(entry.from, 40)} (1:1). Enter sends, Esc cancels.`, e.props.bodyColumns)}</Text>
        <Input
          key="reply"
          value={draft}
          autoFocus
          onInput={(value) => update($, { ...draftRef, id }, () => value)}
          onSubmit={send}
        />
      </Box>
    )
  })
}
