import { displayHandle, identityHandle } from './handle'
import { fitHandle } from './fit-party'
import { safeLine } from './sanitize'

/** Room for any real handle before the short form is taken; a longer one is clipped, never half-shortened. */
const SCRUB_CELLS = 256

/** Room for any real handle in a row, the column's fit (not this cap) decides what of it shows. */
export const HANDLE_SCRUB_CELLS = 128

/** A handle label as the person reads it: scrubbed first, then fitted to `cells` (a remote label keeps its `@`, see `fitHandle`). */
export function fittedHandle(raw: string, cells: number): string {
  return fitHandle(safeLine(raw, SCRUB_CELLS), cells)
}

/** A handle as the person reads it: scrubbed first, then shortened against the org's own slug, then fitted to `cells`. */
export function shownHandle(raw: string, ownSlug: string | null, cells: number): string {
  return fitHandle(displayHandle(safeLine(raw, SCRUB_CELLS), ownSlug), cells)
}

/** The org slug an agent's own handle carries, or null when the handle is not a `.rine.network` one. */
export function ownSlugOf(handle: string | null): string | null {
  if (handle === null) return null
  const clean = safeLine(handle, SCRUB_CELLS)
  const short = identityHandle(clean)
  return short === clean ? null : short.slice(short.lastIndexOf('@') + 1)
}
