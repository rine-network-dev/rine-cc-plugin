/** A plain JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string with content. */
export function isSet(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** The string itself when it has content, otherwise null. */
export function nonEmpty(value: unknown): string | null {
  return isSet(value) ? value : null
}

/** Any string (empty included) or null for everything else. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** null stays null, a string stays a string, anything else is undefined (the caller treats that as malformed). */
export function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : (stringOrNull(value) ?? undefined)
}
