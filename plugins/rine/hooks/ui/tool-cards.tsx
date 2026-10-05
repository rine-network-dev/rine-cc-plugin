import type { Register } from 'claude-code'
import { read, update } from 'claude-code'
import { cardOf, cardToolOf, parseOutput } from './tool-output'

const rawRef = { plugin: 'rine', key: 'isRawShown' } as const

const DEFAULT_COLUMNS = 80

export const registerToolCards = (on: Parameters<Register>[0]): void => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool_use_id: id, tool, output, isErrored } = e.props
    const kind = cardToolOf(tool)
    const data = kind === null || isErrored ? null : parseOutput(output)
    if (kind === null || data === null) return next(e)
    if ((await read($, { ...rawRef, id })) === true) return next(e)
    const card = cardOf(kind, data, { now: await $.clock.now(), columns: e.viewport?.columns ?? DEFAULT_COLUMNS })
    if (card === null) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {card.header !== null && <Text key="header">{card.header}</Text>}
        {card.rows.map((row, index) => <Text key={`row-${index}`}>{row}</Text>)}
        {card.body !== null && <Text key="body">{card.body}</Text>}
        {card.notes.map((note, index) => <Text key={`note-${index}`} dimColor>{note}</Text>)}
        <Button key="raw" label="raw" onPress={() => update($, { ...rawRef, id }, () => true)} />
      </Box>
    )
  })
}
