import { displayWidth, safeLine } from '../lib/sanitize'

export const FLEX = 'flex' as const

/** One column of a row: fixed cells, or `FLEX` for what the fixed ones leave. A narrow row drops its `isOptional` cells, last first. */
export type Cell = { text: string; width: number | typeof FLEX; align?: 'left' | 'right'; isOptional?: true }

const GAP = 1

/** `text` scrubbed and clipped (with `…`) to exactly `width` cells, padded on the side `align` leaves free. */
export function fit(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const clipped = safeLine(text, width)
  const pad = ' '.repeat(Math.max(0, width - displayWidth(clipped)))
  return align === 'right' ? pad + clipped : clipped + pad
}

function widthsOf(cells: readonly Cell[], columns: number): number[] {
  const widths = cells.map((cell) => (cell.width === FLEX ? 0 : cell.width))
  const used = (): number => {
    const live = widths.filter((width) => width > 0)
    return live.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, live.length - 1)
  }
  const optional = cells.map((cell, at) => (cell.isOptional ? at : -1)).filter((at) => at >= 0)
  while (used() > columns && optional.length > 0) widths[optional.pop() as number] = 0
  for (let over = used() - columns; over > 0; over = used() - columns) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] as number) <= 1) break
    widths[widest] = (widths[widest] as number) - Math.min(over, (widths[widest] as number) - 1)
  }
  const flexes = cells.flatMap((cell, at) => (cell.width === FLEX ? [at] : []))
  const free = Math.max(0, columns - used() - (flexes.length > 0 && used() > 0 ? GAP : 0))
  flexes.forEach((at, order) => {
    widths[at] = Math.floor(free / flexes.length) + (order === flexes.length - 1 ? free % flexes.length : 0)
  })
  return widths
}

/**
 * The cells of one row laid out in `columns`: every returned string is its cell's text fitted to the cell's width, and,
 * except for the last cell drawn, followed by the one-cell gap. A dropped or empty cell is ''. The row never measures
 * more than `columns` cells, whatever the text holds.
 */
export function layoutRow(cells: readonly Cell[], columns: number): string[] {
  const widths = widthsOf(cells, columns)
  const lastAt = widths.reduce((last, width, at) => (width > 0 ? at : last), -1)
  return cells.map((cell, at): string => {
    const width = widths[at] as number
    return width > 0 ? fit(cell.text, width, cell.align) + (at === lastAt ? '' : ' '.repeat(GAP)) : ''
  })
}

/** The widest of `texts` in cells, capped at `cap`: the width of a column that should hug its content. */
export function hugWidth(texts: readonly string[], cap: number): number {
  return Math.min(cap, texts.reduce((widest, text) => Math.max(widest, displayWidth(safeLine(text, cap))), 0))
}
