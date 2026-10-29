import { read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'spike-pane'
const revRef = { plugin: 'spike-client', key: 'rev' } as const
// Built at run time, so the source never holds the strings the driver greps the engine's output for.
const PROP_MARK = ['PROP', 'MARK', '4417'].join('')
const SPAWN_ARGV = ['node', '-e', 'console.log(["SPAWN","OUT","9082"].join(""))']

// Module memory: read by the render closure, written by the ui.message hook, never put in $.state.
let mem = 0
let renders = 0
let spawnBytes = -1
const events: unknown[] = []
try {
  ;(globalThis as any).__spikeMem = 'reachable'
} catch {
  /* the sandbox may refuse; the observer reports what it sees */
}

async function spawnChild($: any): Promise<void> {
  const child = $.process.spawn({ argv: SPAWN_ARGV })
  let bytes = 0
  for (;;) {
    const step = await child.next()
    if (step.done) break
    bytes += step.value.text.length
  }
  spawnBytes = bytes
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike', description: 'Open the spike pane' })
    return next(e)
  })
  on('command.run', { command: 'spike' }, async ($) => {
    const opened = await $.ui.open({ id: PANE, title: 'Spike', focus: true })
    return { text: `spike pane placed=${opened.isPlaced}` }
  })
  on('ui.message', async ($, e) => {
    const d = e.data as { op: string; key: string }
    events.push({ ...(e.data as object), element: e.element, component: e.component })
    if (d.op === 'mem') mem += 1
    if (d.op === 'rev') await update($, revRef, (n) => (n ?? 0) + 1)
    if (d.op === 'inval') await $.ui.invalidate('ui.render')
    if (d.op === 'spawn') {
      await spawnChild($)
      await $.ui.invalidate('ui.render')
    }
    const out = await $.env.get('SPIKE_OUT')
    await $.fs.write(out, JSON.stringify(events))
    await $.ui.log(`spike key ${d.key} op ${d.op}`, { to: 'debug' })
    return {}
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Client } = $.ui.resolve(e)
    renders += 1
    const rev = (await read($, revRef)) ?? 0
    return (
      <Box flexDirection="column">
        <Text>{`SPIKE MEM=${mem} REV=${rev} RENDERS=${renders} SPAWNBYTES=${spawnBytes} GLOBAL=${typeof (globalThis as any).__spikeMem} FOCUSED=${e.props.isFocused}`}</Text>
        <Client key="spike" module="./spike-view.tsx" props={{ marker: PROP_MARK }} height={4} />
      </Box>
    )
  })
}
