import { FRAME_MS } from '../lib/motion'

type Timer = { cancel: () => void }

/** What the effects reach on the engine. The hook that draws builds it over its own `$`, which never crosses an import. */
export type Pulse = {
  now: () => Promise<number>
  every: (ms: number, fn: () => void | Promise<void>) => Timer
  redraw: () => void
}

// Module memory on purpose: both hold only times, never message text, and a hot reload that drops them only ends an
// animation early.
let deadline = 0
let timer: Timer | null = null
const opened = new Map<string, number>()

/**
 * Keeps `ui.render` redrawing every `FRAME_MS` until `until` (ms on the engine clock). One timer serves every effect in
 * flight: it starts with the first request, stretches to the latest deadline, and cancels itself after the frame that
 * lands past it, so a still screen runs no timer at all.
 */
export function drive(pulse: Pulse, until: number): void {
  deadline = Math.max(deadline, until)
  if (timer !== null) return
  const running = pulse.every(FRAME_MS, async () => {
    pulse.redraw()
    if ((await pulse.now()) < deadline) return
    running.cancel()
    if (timer === running) timer = null
  })
  timer = running
}

/** When the reader first drew `id`: the start of its decode. Remembered until `closeReader`. */
export function readerOpenedAt(id: string, now: number): number {
  const known = opened.get(id)
  if (known !== undefined) return known
  opened.set(id, now)
  return now
}

/** The reader is closed: the next open decodes again. */
export function closeReader(): void {
  opened.clear()
}
