import type { Register } from 'claude-code'
import { read, update } from 'claude-code'
import type { RineEntry } from '../../types/index'
import { MCP_SERVER } from '../lib/refs'
import { safeLine } from '../lib/sanitize'
import { fittedHandle } from '../lib/shown-handle'

const entriesRef = { plugin: 'rine', key: 'entries' } as const
const focusRef = { plugin: 'rine', key: 'focusId' } as const
const draftRef = { plugin: 'rine', key: 'replyDraft' } as const

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
        <Text>{safeLine(`Reply to ${fittedHandle(entry.from, 40)} (1:1). Enter sends, Esc cancels.`, e.props.bodyColumns)}</Text>
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
