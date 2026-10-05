export type Scrubbed = { text: string; hiddenChars: number }
export type Block = { text: string; hiddenChars: number; truncatedChars: number }

const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const STRING_SEQUENCE = /\x1b[\]P_^][\s\S]{0,4096}?(\x07|\x1b\\)/g
const LONE_ESC = /\x1b/g

const MAX_SCRUBBED_CHARS = 16384

const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

const COMBINING = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/u
const WIDE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u

const RINE_TYPE = /^rine\.v1\.[a-z0-9_]{1,40}$/

function cellWidth(ch: string): number {
  if (COMBINING.test(ch)) return 0
  return WIDE.test(ch) ? 2 : 1
}

function clampForScrub(s: string): { text: string; dropped: number } {
  const chars = Array.from(s)
  if (chars.length <= MAX_SCRUBBED_CHARS) return { text: s, dropped: 0 }
  return {
    text: chars.slice(0, MAX_SCRUBBED_CHARS).join(''),
    dropped: chars.length - MAX_SCRUBBED_CHARS
  }
}

export function scrub(s: string, isOneLine: boolean): Scrubbed {
  const before = Array.from(s).length
  const withoutSequences = s.replace(CSI, '').replace(STRING_SEQUENCE, '').replace(LONE_ESC, '')
  const deleted = withoutSequences.replace(INVISIBLE, '')
  const hiddenChars = before - Array.from(deleted).length
  const spaced = deleted.replace(/\t/g, ' ')
  const newlined = spaced.replace(/[\u2028\u2029]/g, '\n')
  const text = isOneLine
    ? newlined.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    : newlined.replace(/\n{3,}/g, '\n\n')
  return { text, hiddenChars }
}

export function displayWidth(s: string): number {
  let width = 0
  for (const ch of s) width += cellWidth(ch)
  return width
}

export function safeLine(s: string, maxCells: number): string {
  if (maxCells < 1) return ''
  const text = scrub(clampForScrub(s).text, true).text
  if (displayWidth(text) <= maxCells) return text
  const chars = Array.from(text)
  let width = 0
  let cut = 0
  for (let char = chars[0]; char !== undefined && width + cellWidth(char) + 1 <= maxCells; char = chars[cut]) {
    width += cellWidth(char)
    cut += 1
  }
  return chars.slice(0, cut).join('') + '…'
}

export function safeBlock(s: string, maxChars: number): Block {
  const clamped = clampForScrub(s)
  const scrubbed = scrub(clamped.text, false)
  const chars = Array.from(scrubbed.text)
  if (chars.length <= maxChars) {
    return { text: scrubbed.text, hiddenChars: scrubbed.hiddenChars, truncatedChars: clamped.dropped }
  }
  return {
    text: chars.slice(0, maxChars).join(''),
    hiddenChars: scrubbed.hiddenChars,
    truncatedChars: chars.length - maxChars + clamped.dropped
  }
}

export function quoteField(s: string): string {
  return JSON.stringify(safeLine(s, 120))
}

export function modelType(t: string): string {
  return RINE_TYPE.test(t) ? JSON.stringify(t) : JSON.stringify('(custom type)')
}

/** The markers a scrubbed block carries beside its text: what was cut off, and what was removed. */
export function scrubNotes(truncatedChars: number | undefined, hiddenChars: number | undefined): string[] {
  return [
    truncatedChars ? `+${truncatedChars} chars not shown` : null,
    hiddenChars ? `${hiddenChars} hidden/control characters removed` : null
  ].filter((note): note is string => note !== null)
}
