import type { RinePrefs } from '../../types/index'
import { readSealed, updateSealed, type Updated } from './envelope'
import { isRecord } from './narrow'
import type { Ports } from './ports'
import { statePath } from './refs'

export const DEFAULT_PREFS: RinePrefs = { mutedUntil: null, isMuteExplicit: false, isPreview: false }

export type MuteSpec = '1h' | '8h' | 'off-hours' | 'forever'

const HOUR_MS = 3600000
const OFF_HOURS_END = 8

function normalizePrefs(value: unknown): RinePrefs | null {
  if (!isRecord(value)) return null
  const muted = value.mutedUntil
  const isTimed = typeof muted === 'number' && Number.isFinite(muted)
  return {
    mutedUntil: muted === 'forever' ? 'forever' : isTimed ? muted : null,
    isMuteExplicit: value.isMuteExplicit === true,
    isPreview: value.isPreview === true
  }
}

/** An absent file holds the defaults; an unknown one keeps the last good value. */
export async function readPrefs(
  ports: Pick<Ports, 'fs' | 'clock'>,
  rineDir: string,
  previous: RinePrefs = DEFAULT_PREFS
): Promise<RinePrefs> {
  const sealed = await readSealed(ports, statePath(rineDir, 'prefs'))
  if (sealed.status === 'absent') return DEFAULT_PREFS
  return (sealed.status === 'ok' ? normalizePrefs(sealed.value) : null) ?? previous
}

/** A human edit of the file: `edit` answers the next prefs, or undefined for no change. */
export async function updatePrefs(
  ports: Pick<Ports, 'fs' | 'clock'>,
  rineDir: string,
  edit: (prefs: RinePrefs) => RinePrefs | undefined,
  previous: RinePrefs = DEFAULT_PREFS
): Promise<Updated<RinePrefs>> {
  return updateSealed<RinePrefs>(ports, statePath(rineDir, 'prefs'), (current) => {
    const stored = current.status === 'ok' ? normalizePrefs(current.value) : null
    return edit(stored ?? (current.status === 'absent' ? DEFAULT_PREFS : previous))
  })
}

/** When a mute ends: an hour count from now, the next local 08:00 for `off-hours`, or `'forever'`. */
export function muteDeadline(spec: MuteSpec, now: number): number | 'forever' {
  if (spec === 'forever') return 'forever'
  if (spec === '1h') return now + HOUR_MS
  if (spec === '8h') return now + 8 * HOUR_MS
  const end = new Date(now)
  end.setHours(OFF_HOURS_END, 0, 0, 0)
  if (end.getTime() <= now) end.setDate(end.getDate() + 1)
  return end.getTime()
}

/** Mutes until `mutedUntil`, or unmutes with null. Either way the choice is explicit from now on. */
export function withMute(prefs: RinePrefs, mutedUntil: number | 'forever' | null): RinePrefs {
  return { ...prefs, mutedUntil, isMuteExplicit: true }
}

export function withPreview(prefs: RinePrefs, isPreview: boolean): RinePrefs {
  return { ...prefs, isPreview }
}

export function legacyPausePath(rineDir: string): string {
  return `${rineDir}/monitor-pause`
}

export function hasLegacyPause(ports: Pick<Ports, 'fs'>, rineDir: string): Promise<boolean> {
  return ports.fs.exists(legacyPausePath(rineDir))
}

/** The old pause file mutes only while the file holds no explicit mute choice. */
export function isMuted(prefs: RinePrefs, now: number, isLegacyPaused: boolean): boolean {
  if (!prefs.isMuteExplicit) return isLegacyPaused
  if (prefs.mutedUntil === null) return false
  return prefs.mutedUntil === 'forever' || prefs.mutedUntil > now
}
