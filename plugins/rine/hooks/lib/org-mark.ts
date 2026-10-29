import type { Tone } from './tone'

/** The character for each verdict name the feed carries, as the terminal reader draws it. */
const VERDICT_MARKS: Record<string, string> = {
  verified: '✓',
  invalid: '✗',
  senderMismatch: '✗',
  unverifiable: '?',
  gap: '!'
}

const VERDICT_TONES: Record<string, Tone> = {
  verified: 'success',
  invalid: 'error',
  senderMismatch: 'error',
  unverifiable: 'warning',
  gap: 'warning'
}

export const EQUIVOCATION_MARK = '≠'
export const EQUIVOCATION_SENTENCE = 'two different copies of this message were seen'

/** The one-cell mark for a verdict name; a name this build does not know reads as unverifiable. */
export const verdictMark = (name: string): string => VERDICT_MARKS[name] ?? '?'

/** The colour of a verdict name; an unknown name reads as unverifiable. */
export const verdictTone = (name: string): Tone => VERDICT_TONES[name] ?? 'warning'

const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
const MICRO_DIGITS = 6

/** Microseconds since the epoch; `Date.parse` stops at milliseconds. 0 for text that is not an RFC 3339 instant. */
export function instantMicros(text: string): number {
  const match = INSTANT.exec(text)
  if (match === null) return 0
  const seconds = Date.parse(`${match[1]}${match[3]}`)
  if (Number.isNaN(seconds)) return 0
  return seconds * 1000 + Number((match[2] ?? '').slice(0, MICRO_DIGITS).padEnd(MICRO_DIGITS, '0'))
}
