import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../hooks/lib/sanitize'
import { FLEX, fit, hugWidth, layoutRow } from '../hooks/ui/columns'

test('test_fit_shortText_padsToWidth', async () => {
  expect(fit('bob', 6)).toBe('bob   ')
  expect(fit('bob', 6, 'right')).toBe('   bob')
})

test('test_fit_longText_clipsWithEllipsisToExactWidth', async () => {
  const out = fit('a very long snippet indeed', 10)
  expect(out.endsWith('…')).toBe(true)
  expect(displayWidth(out)).toBe(10)
})

test('test_fit_wideCharacters_countTwoCells', async () => {
  const out = fit('日本語日本語', 7)
  expect(displayWidth(out)).toBe(7)
})

test('test_fit_controlBytes_areScrubbedBeforeMeasuring', async () => {
  const out = fit('a\u001b[31mred\u001b[0m', 12)
  expect(out).not.toContain('\u001b')
  expect(displayWidth(out)).toBe(12)
})

test('test_layoutRow_flexCell_takesWhatFixedCellsLeave', async () => {
  const [from, snippet, date] = layoutRow(
    [
      { text: 'alice', width: 8 },
      { text: 'hello there', width: FLEX },
      { text: '2d', width: 4, align: 'right' },
    ],
    30
  ) as [string, string, string]
  expect(from).toBe('alice    ')
  expect(displayWidth(from + snippet + date)).toBe(30)
  expect(date).toBe('  2d')
})

test('test_layoutRow_narrowRow_dropsOptionalCellsLastFirst', async () => {
  const parts = layoutRow(
    [
      { text: 'alice', width: 8 },
      { text: 'hello', width: FLEX },
      { text: 'yesterday', width: 9, isOptional: true },
    ],
    14
  )
  expect(parts[2]).toBe('')
  expect(displayWidth(parts.join(''))).toBeLessThanOrEqual(14)
})

test('test_layoutRow_anyText_neverExceedsColumns', async () => {
  for (const columns of [1, 5, 12, 40]) {
    const row = layoutRow(
      [
        { text: '日本語の名前', width: 12 },
        { text: 'x'.repeat(200), width: FLEX },
        { text: 'now', width: 9, align: 'right', isOptional: true },
      ],
      columns
    )
    expect(displayWidth(row.join(''))).toBeLessThanOrEqual(columns)
  }
})

test('test_hugWidth_widestText_cappedAtCap', async () => {
  expect(hugWidth(['ab', 'abcd'], 10)).toBe(4)
  expect(hugWidth(['a'.repeat(50)], 10)).toBe(10)
  expect(hugWidth([], 10)).toBe(0)
})
