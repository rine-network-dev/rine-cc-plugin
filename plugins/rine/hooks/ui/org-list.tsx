import { humanTime } from '../lib/human-time'
import type { Look } from '../lib/motion'
import { PARTIES_CELLS, type OrgWindowRow } from '../lib/org-rows'
import { EQUIVOCATION_MARK } from '../lib/org-mark'
import { toned, type Ui } from './cells'
import { FLEX, hugWidth, layoutRow } from './columns'

const DATE_CELLS = 9
/** The selection arrow, two cells. */
const GUTTER = 2

/** The list rows: `▸ alice → bob@corp   "first words…"      3 min ago  ✓`, the verdict mark on every row. */
export function orgRows(ui: Ui, rows: readonly OrgWindowRow[], selectedId: string | null, columns: number, look: Look) {
  const { Box } = ui
  const partiesCells = hugWidth(rows.map((row) => row.parties), PARTIES_CELLS)
  return rows.map((row) => {
    const isSelected = row.id === selectedId
    const [parties, snippet, date, mark, equivocal] = layoutRow(
      [
        { text: row.parties, width: partiesCells },
        { text: row.snippet, width: FLEX },
        { text: humanTime(row.createdAt, look.now), width: DATE_CELLS, align: 'right', isOptional: true },
        { text: row.mark, width: 1 },
        { text: row.equivocal ? EQUIVOCATION_MARK : '', width: 1 }
      ],
      columns - GUTTER
    )
    return (
      <Box key={`org:${row.id}`} flexDirection="row">
        {toned(ui, 'select', isSelected ? '▸ ' : '  ')}
        {toned(ui, 'parties', parties ?? '', 'plain', isSelected)}
        {toned(ui, 'snippet', snippet ?? '', row.snippetTone)}
        {toned(ui, 'date', date ?? '', 'dim')}
        {toned(ui, 'mark', mark ?? '', row.tone)}
        {toned(ui, 'equivocal', equivocal ?? '', 'suggestion')}
      </Box>
    )
  })
}
