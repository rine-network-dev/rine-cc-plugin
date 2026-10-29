import { cellsOf } from './sanitize'

// Every effect is a pure function of an age in milliseconds, so a frame is the same wherever and whenever it is drawn
// and the resting frame (age past the effect, or motion off) is the plain text. Noise comes only from the glyph sets
// below and never from Math.random; the text it resolves into is already scrubbed by the caller.

export const PULSE_FRAMES = ['●', '◉', '○', '◉'] as const
export const PULSE_MS = 350
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const SPINNER_MS = 80
/** The hooks-side clock period while a shimmer, reveal or decode is in flight. */
export const FRAME_MS = 50
export const SHIMMER_MS = 480
export const REVEAL_MS = 600
export const DECODE_MS = 350

const SHADES = ['░', '▒', '▓'] as const
const NOISE = ['░', '▒', '▓', '⠁', '⠂', '⠄', '⠐', '⠠', '⡀', '⢀'] as const
const SHIMMER_STEP_MS = 60
const SHIMMER_STAGGER_MS = 12
const REVEAL_STAGGER_MS = 90
const REVEAL_STEP_MS = 80

/** What the renderers need of the moment: the time, whether to animate, and a way to ask for frames until a deadline. */
export type Look = { now: number; isMotion: boolean; wake: (until: number) => void }

/** A look with no animation, for a drawing that has no pump behind it. */
export const stillLook = (now: number): Look => ({ now, isMotion: false, wake: () => undefined })

/** Motion plays on the terminal surface only, and only while the person's `/rine motion` is on. */
export const isMotionOn = (surface: string, prefs: { isMotion?: boolean }): boolean => surface === 'terminal' && prefs.isMotion === true

/** A deterministic glyph for one cell of one frame: a hash of the two, never a random draw. */
export function noiseGlyph(index: number, frame: number): string {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(frame + 1, 0x85ebca6b)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  return NOISE[(h >>> 0) % NOISE.length] as string
}

const blanks = (cluster: string): boolean => cluster.trim() === ''

/** A new row's text arriving: each cell runs `░ ▒ ▓ text` left to right, the whole cascade inside `SHIMMER_MS`. */
export function shimmer(text: string, ageMs: number): string {
  if (ageMs >= SHIMMER_MS) return text
  const parts = cellsOf(text)
  const stagger = parts.length > 1 ? Math.min(SHIMMER_STAGGER_MS, (SHIMMER_MS - 3 * SHIMMER_STEP_MS) / (parts.length - 1)) : 0
  return parts
    .map(({ cluster, width }, at) => {
      if (blanks(cluster) || width === 0) return cluster
      const step = Math.floor((ageMs - at * stagger) / SHIMMER_STEP_MS)
      if (step >= SHADES.length) return cluster
      return (step < 0 ? ' ' : (SHADES[step] as string)).repeat(width)
    })
    .join('')
}

/** The wordmark resolving from shaded blocks, letter by letter: `▓ ▒ ░ letter`. */
export function reveal(word: string, ageMs: number): string {
  if (ageMs >= REVEAL_MS) return word
  return Array.from(word)
    .map((letter, at) => {
      const stage = ageMs - at * REVEAL_STAGGER_MS < 0 ? 0 : Math.floor((ageMs - at * REVEAL_STAGGER_MS) / REVEAL_STEP_MS) + 1
      return stage >= 3 ? letter : ((['▓', '▒', '░'] as const)[stage] as string)
    })
    .join('')
}

/**
 * Lines of already-clean text resolving from noise: a front crosses the visible cells in `DECODE_MS` whatever their
 * count, and the cells it has not reached show a deterministic glyph. Blanks stay blanks, so the layout never moves.
 */
export function decodeLines(lines: readonly string[], ageMs: number): string[] {
  if (ageMs >= DECODE_MS) return [...lines]
  const total = lines.reduce((sum, line) => sum + cellsOf(line).length, 0)
  const front = Math.floor(total * Math.max(0, ageMs / DECODE_MS))
  const frame = Math.floor(ageMs / FRAME_MS)
  let index = 0
  return lines.map((line) =>
    cellsOf(line)
      .map(({ cluster, width }) => {
        const at = index
        index += 1
        if (at < front || blanks(cluster) || width === 0) return cluster
        return noiseGlyph(at, frame).repeat(width)
      })
      .join('')
  )
}
