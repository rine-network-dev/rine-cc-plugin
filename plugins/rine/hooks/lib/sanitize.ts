import { WIDE_RANGES } from './terminal-width-table'

export type Scrubbed = { text: string; hiddenChars: number }
export type Block = { text: string; hiddenChars: number; truncatedChars: number }

// A control string runs to its terminator, or to the end of the input when it has none, so an unterminated
// sequence never leaves its payload on screen. The 8-bit introducers are handled like their ESC forms.
// The same ruleset as rine-core/src/terminal-text.ts; tests/terminal-text-vectors.ts is generated from the vectors
// both are held to.
const OSC = /(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c|$)/g
const OTHER_STRING = /(?:\x1b[PX^_]|[\u0090\u0098\u009e\u009f])[\s\S]*?(?:\x1b\\|\u009c|$)/g
const CSI = /(?:\x1b\[|\u009b)[0-?]*[ -/]*[@-~]?/g
const LONE_ESC = /\x1b/g

const MAX_SCRUBBED_CHARS = 16384

const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

// Width is per grapheme cluster, as in rine-core/src/terminal-width.ts: the widest code point of the cluster.
// The wide ranges are generated from the same Unicode data as rine-core's (scripts/gen-terminal-width.mjs).
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const ZERO_WIDTH = /^[\p{M}\p{Cf}\p{Cc}]$/u

function isWide(cp: number): boolean {
  let lo = 0
  let hi = WIDE_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [first, last] = WIDE_RANGES[mid] as readonly [number, number]
    if (cp < first) hi = mid - 1
    else if (cp > last) lo = mid + 1
    else return true
  }
  return false
}

const RINE_TYPE = /^rine\.v1\.[a-z0-9_]{1,40}$/

function clusters(s: string): string[] {
  return Array.from(SEGMENTER.segment(s), (part) => part.segment)
}

function clusterWidth(cluster: string): 0 | 1 | 2 {
  let width: 0 | 1 = 0
  for (const ch of cluster) {
    if (isWide(ch.codePointAt(0) as number)) return 2
    if (!ZERO_WIDTH.test(ch)) width = 1
  }
  return width
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
  const withoutSequences = s.replace(OSC, '').replace(OTHER_STRING, '').replace(CSI, '').replace(LONE_ESC, '')
  const deleted = withoutSequences.replace(INVISIBLE, '')
  const hiddenChars = before - Array.from(deleted).length
  const spaced = deleted.replace(/\t/g, ' ')
  const newlined = spaced.replace(/[\u2028\u2029]/g, '\n')
  const text = isOneLine
    ? newlined.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    : newlined.replace(/\n{3,}/g, '\n\n')
  return { text, hiddenChars }
}

/** The grapheme clusters of `s`, each with the cells it takes on screen. */
export function cellsOf(s: string): { cluster: string; width: 0 | 1 | 2 }[] {
  return clusters(s).map((cluster) => ({ cluster, width: clusterWidth(cluster) }))
}

export function displayWidth(s: string): number {
  let width = 0
  for (const cluster of clusters(s)) width += clusterWidth(cluster)
  return width
}

export function safeLine(s: string, maxCells: number): string {
  if (maxCells < 1) return ''
  const text = scrub(clampForScrub(s).text, true).text
  if (displayWidth(text) <= maxCells) return text
  let width = 0
  let kept = ''
  for (const cluster of clusters(text)) {
    const columns = clusterWidth(cluster)
    if (width + columns + 1 > maxCells) break
    width += columns
    kept += cluster
  }
  return kept + '…'
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
