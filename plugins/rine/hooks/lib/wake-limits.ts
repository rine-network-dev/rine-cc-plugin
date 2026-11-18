export const WAKE_SPACING_MS = 30000
export const WAKES_PER_HOUR = 12

const HOUR_MS = 3600000

/** The stamps still inside the rolling hour. */
export function recent(wakes: readonly number[], now: number): number[] {
  return wakes.filter((at) => now - at < HOUR_MS)
}

/** Milliseconds until the 30 s spacing since the newest wake is over; 0 when it blocks nothing. */
export function spacingWaitMs(wakes: readonly number[], now: number): number {
  const last = wakes.reduce((latest, at) => Math.max(latest, at), 0)
  return Math.max(0, last + WAKE_SPACING_MS - now)
}

/** True once the rolling hour already holds 12 wakes. */
export function isHourlyCapReached(wakes: readonly number[], now: number): boolean {
  return recent(wakes, now).length >= WAKES_PER_HOUR
}

/** One wake per 30 s and 12 per rolling hour. */
export function isWakeAllowed(wakes: readonly number[], now: number): boolean {
  return spacingWaitMs(wakes, now) === 0 && !isHourlyCapReached(wakes, now)
}
