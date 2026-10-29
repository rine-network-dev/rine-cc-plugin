import { isRecord, nonEmpty, nullableString } from './narrow'

export type Obj = Record<string, unknown>

export type OrgGap = { reason: string }

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function nullableNum(value: unknown): number | null | undefined {
  return value === null || value === undefined ? null : num(value)
}

/** A missing key reads as null; only a present value of the wrong type is a shape error. */
export function optionalString(value: unknown): string | null | undefined {
  return value === undefined ? null : nullableString(value)
}

const MAX_ID_CHARS = 256
const ID_PATTERN = new RegExp(`^[\\x21-\\x7e]{1,${MAX_ID_CHARS}}$`)

/** An id or cursor the plugin will carry into props, ring keys and argv: printable ASCII, no spaces, length-capped. */
export function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined
}

/** null stays null, a safe id stays itself, anything else (including a missing key) reads as malformed. */
export function nullableId(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : safeId(value)
}

/** A gap object keeps its reason only; null stays null, anything without a reason is malformed. */
export function gap(value: unknown): OrgGap | null | undefined {
  if (value === null) return null
  const reason = isRecord(value) ? nonEmpty(value.reason) : null
  return reason === null ? undefined : { reason }
}

