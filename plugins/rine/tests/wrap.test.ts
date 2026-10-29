import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../hooks/lib/sanitize'
import { isoOfMs, localStamp } from '../hooks/lib/stamp'
import { wrapText } from '../hooks/lib/wrap'

test('test_wrapText_wordsOverWidth_breakAtSpaces', async () => {
  expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
})

test('test_wrapText_newlines_areKeptAndBlankLinesStayBlank', async () => {
  expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b'])
})

test('test_wrapText_wordWiderThanLine_isCutBetweenClusters', async () => {
  const lines = wrapText('abcdefghij', 4)
  expect(lines).toEqual(['abcd', 'efgh', 'ij'])
})

test('test_wrapText_wideCharacters_neverExceedWidth', async () => {
  for (const line of wrapText('日本語日本語日本語 テスト', 5)) expect(displayWidth(line)).toBeLessThanOrEqual(5)
})

test('test_wrapText_zeroWidth_stillTerminates', async () => {
  expect(wrapText('ab', 0).join('')).toBe('ab')
})

test('test_localStamp_validIso_readsLocalMinutePrecision', async () => {
  const at = new Date(2026, 9, 26, 9, 5)
  expect(localStamp(at.toISOString())).toBe('2026-10-26 09:05')
})

test('test_localStamp_garbage_readsEmDash', async () => {
  expect(localStamp('not a time')).toBe('—')
  expect(localStamp('')).toBe('—')
})

test('test_isoOfMs_nonFinite_isEmpty', async () => {
  expect(isoOfMs(Number.NaN)).toBe('')
  expect(isoOfMs(0)).toBe('1970-01-01T00:00:00.000Z')
})
