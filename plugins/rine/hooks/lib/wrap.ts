import { cellsOf, displayWidth } from './sanitize'

/** A word longer than `width`, cut between grapheme clusters so no cluster is split. */
function cutWord(word: string, width: number): string[] {
  const parts: string[] = []
  let line = ''
  let used = 0
  for (const { cluster, width: cells } of cellsOf(word)) {
    if (used + cells > width && line !== '') {
      parts.push(line)
      line = ''
      used = 0
    }
    line += cluster
    used += cells
  }
  return line === '' ? parts : [...parts, line]
}

function wrapLine(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const word of text.split(' ')) {
    const cells = displayWidth(word)
    if (line !== '' && used + 1 + cells <= width) {
      line += ` ${word}`
      used += 1 + cells
      continue
    }
    if (line !== '') lines.push(line)
    const parts = cells <= width ? [word] : cutWord(word, width)
    lines.push(...parts.slice(0, -1))
    line = parts[parts.length - 1] ?? ''
    used = displayWidth(line)
  }
  return [...lines, line]
}

/**
 * Already-scrubbed `text` as lines of at most `width` cells: broken at spaces, a word wider than the line cut between
 * clusters, newlines kept (a blank line stays blank). Wide characters count two cells.
 */
export function wrapText(text: string, width: number): string[] {
  const cells = Math.max(1, width)
  return text.split('\n').flatMap((line) => wrapLine(line, cells))
}
