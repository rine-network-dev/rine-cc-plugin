import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../hooks/lib/sanitize'
import { DECODE_MS, REVEAL_MS, SHIMMER_MS, decodeLines, isMotionOn, noiseGlyph, reveal, shimmer, stillLook } from '../hooks/lib/motion'

test('test_isMotionOn_terminalWithPref_isOn', async () => {
  expect(isMotionOn('terminal', { isMotion: true })).toBe(true)
})

test('test_isMotionOn_prefOffOrOtherSurface_isOff', async () => {
  expect(isMotionOn('terminal', { isMotion: false })).toBe(false)
  expect(isMotionOn('terminal', {})).toBe(false)
  expect(isMotionOn('desktop', { isMotion: true })).toBe(false)
  expect(isMotionOn('mobile', { isMotion: true })).toBe(false)
})

test('test_stillLook_wake_isInert', async () => {
  const look = stillLook(5)
  expect(look.isMotion).toBe(false)
  expect(look.wake(10)).toBeUndefined()
})

test('test_noiseGlyph_sameInputs_sameGlyph', async () => {
  for (let i = 0; i < 20; i++) expect(noiseGlyph(i, 3)).toBe(noiseGlyph(i, 3))
  const seen = new Set(Array.from({ length: 40 }, (_, i) => noiseGlyph(i, 1)))
  expect(seen.size).toBeGreaterThan(1)
})

test('test_shimmer_pastDuration_isThePlainText', async () => {
  expect(shimmer('hello world', SHIMMER_MS)).toBe('hello world')
})

test('test_shimmer_atStart_hidesLettersButKeepsLayout', async () => {
  const out = shimmer('hello world', 0)
  expect(displayWidth(out)).toBe(displayWidth('hello world'))
  expect(out).not.toContain('h')
  expect(out[5]).toBe(' ')
})

test('test_shimmer_midway_isDeterministic', async () => {
  expect(shimmer('hello world', 200)).toBe(shimmer('hello world', 200))
  expect(displayWidth(shimmer('日本', 100))).toBe(4)
})

test('test_reveal_pastDuration_isTheWordmark', async () => {
  expect(reveal('rine', REVEAL_MS)).toBe('rine')
})

test('test_reveal_atStart_isShadedBlocksOfSameLength', async () => {
  const out = reveal('rine', 0)
  expect(Array.from(out)).toHaveLength(4)
  expect(out).not.toMatch(/[rine]/)
})

test('test_decodeLines_pastDuration_isTheText', async () => {
  expect(decodeLines(['ab cd', 'ef'], DECODE_MS)).toEqual(['ab cd', 'ef'])
})

test('test_decodeLines_atStart_keepsBlanksAndWidths', async () => {
  const lines = ['ab cd', '', '日本']
  const out = decodeLines(lines, 0)
  expect(out.map(displayWidth)).toEqual(lines.map(displayWidth))
  expect(out[0]?.[2]).toBe(' ')
  expect(out[1]).toBe('')
  expect(out[0]).not.toContain('a')
})

test('test_decodeLines_midway_resolvesLeftToRight', async () => {
  const out = decodeLines(['abcdefghij'], DECODE_MS / 2)[0] as string
  expect(out.startsWith('abcde')).toBe(true)
  expect(out.slice(5)).not.toMatch(/[f-j]/)
})
