import type { RenderNode } from 'claude-code'
import { PULSE_FRAMES, PULSE_MS, SPINNER_FRAMES, SPINNER_MS, type Look } from '../lib/motion'
import type { Tone } from '../lib/tone'
import { toned, type Ui } from './cells'

const LIVE_COLOR = 'success'

/** The live dot: cycling `● ◉ ○ ◉` where motion plays, the plain glyph where it does not. Only a live feed pulses. */
export function pulseGlyph(ui: Ui, key: string, glyph: string, look: Look): RenderNode {
  const { Client } = ui
  const isLive = glyph === PULSE_FRAMES[0]
  if (!look.isMotion || !isLive) return toned(ui, key, glyph, isLive ? 'success' : 'plain')
  return <Client key={key} module="./motion.tsx" width={1} height={1} props={{ frames: [...PULSE_FRAMES], periodMs: PULSE_MS, color: LIVE_COLOR }} />
}

/** A braille spinner for something being read: cycling where motion plays, its first frame where it does not. */
export function spinnerGlyph(ui: Ui, key: string, look: Look, tone: Tone = 'dim'): RenderNode {
  const { Client } = ui
  if (!look.isMotion) return toned(ui, key, SPINNER_FRAMES[0], tone)
  return <Client key={key} module="./motion.tsx" width={1} height={1} props={{ frames: [...SPINNER_FRAMES], periodMs: SPINNER_MS }} />
}
