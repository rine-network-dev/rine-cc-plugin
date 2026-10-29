// The plugin's copy of rine-core/src/display-handle.ts (the plugin cannot import rine-core). The two are held
// to one vector file, rine-core/test/fixtures/display-handle-vectors.json, through tests/display-handle-vectors.ts.

/** `local@slug.rine.network` in any letter case; the local part may lead with the group `#`. */
const RINE_HANDLE = /^(#?[^@\s]+)@([a-z0-9-]+)\.rine\.network$/i

/** An org slug: 2-32 lower-case alphanumerics and hyphens, none at either end (rine-core's `validateSlug`). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/

/**
 * A handle as a person reads it: the org's own agents and groups bare (`sales`, `#ops`), another org's as
 * `local@slug`, and anything that is not exactly `<valid slug>.rine.network` unchanged. Only shortens: sanitise
 * the text first.
 */
export function displayHandle(handle: string, ownSlug: string | null): string {
  const match = RINE_HANDLE.exec(handle)
  if (match === null) return handle
  const [, local = '', rawSlug = ''] = match
  const slug = rawSlug.toLowerCase()
  if (!SLUG.test(slug)) return handle
  return slug === ownSlug ? local : `${local}@${slug}`
}

/** Who an agent is when no org is "own": the short form, never bare. */
export function identityHandle(handle: string): string {
  return displayHandle(handle, null)
}
