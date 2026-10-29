// The surface module under test: it draws what it receives and posts every key it is handed.
type Key = { key: string; ctrl?: true; shift?: true; meta?: true }
type View = { n: number; pointer: number; last: string[] }

const label = (k: Key): string => `${k.ctrl ? 'C-' : ''}${k.meta ? 'M-' : ''}${k.shift ? 'S-' : ''}${k.key}`

/** The op the hooks module acts on; every other key is only logged. */
const OPS: Record<string, string> = { '1': 'mem', '2': 'rev', '3': 'inval', s: 'spawn' }

export default function SpikeView(props: { marker: string }, surface: any) {
  const { Box, Text } = surface.elements
  const view: View = surface.state ?? { n: 0, pointer: 0, last: [] }
  surface.onKey((k: Key) => {
    const cur: View = surface.state ?? { n: 0, pointer: 0, last: [] }
    const next = { ...cur, n: cur.n + 1, last: [...cur.last, label(k)].slice(-10) }
    surface.setState(next)
    surface.post({ op: OPS[k.key] ?? 'key', n: next.n, key: k.key, ctrl: k.ctrl === true, shift: k.shift === true, meta: k.meta === true })
  })
  surface.onPointer((p: { type: string }) => {
    if (p.type !== 'down') return
    const cur: View = surface.state ?? { n: 0, pointer: 0, last: [] }
    surface.setState({ ...cur, pointer: cur.pointer + 1 })
    surface.post({ op: 'pointer', n: cur.n, key: 'pointer-down', ctrl: false, shift: false, meta: false })
  })
  return (
    <Box flexDirection="column">
      <Text>{`CLIENT keys=${view.n} clicks=${view.pointer} size=${surface.columns}x${surface.rows} marker=${props.marker}`}</Text>
      <Text>{`LAST ${view.last.join(' ')}`}</Text>
    </Box>
  )
}
