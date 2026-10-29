import type { RinePrefs } from '../../types/index'
import { isMotionOn, type Look } from '../lib/motion'
import { drive, type Pulse } from './pump'

/** The moment a drawing is made in: the time, whether the surface and the person's pref allow motion, and the way to ask for frames. */
export async function lookOf(pulse: Pulse, surface: string, prefs: Pick<RinePrefs, 'isMotion'> | undefined): Promise<Look> {
  return {
    now: await pulse.now(),
    isMotion: prefs !== undefined && isMotionOn(surface, prefs),
    wake: (until) => drive(pulse, until)
  }
}
