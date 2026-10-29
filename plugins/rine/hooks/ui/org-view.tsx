import type { ClientModule } from 'claude-code'

/** A key as the client hands it over, and with the number it was taken as. */
type Taken = { seq: number; key: string; ctrl?: true; meta?: true }

/** Each post carries the latest keys, because a later post in the same frame replaces one not yet delivered. */
const TAIL = 16

let epoch = ''
let seq = 0
let tail: Taken[] = []

/**
 * The surface module of the org tab: one hint line, and every key it is given goes up to the plugin, which holds the rows
 * and draws the text. It takes no props, so the rows never travel as module props; the rendered tree is
 * still readable by other plugins, which the tab's acknowledgement says. It gets keys only after a click; Escape,
 * ctrl-d and ctrl-x never arrive.
 */
const OrgView: ClientModule<Record<string, never>> = (_props, surface) => {
  const { Text } = surface.elements
  surface.onKey((event) => {
    epoch ||= Math.random().toString(36).slice(2)
    seq += 1
    tail = [...tail, { seq, ...event }].slice(-TAIL)
    surface.post({ epoch, keys: tail })
  })
  return <Text dimColor>click here for vi keys</Text>
}

export default OrgView
