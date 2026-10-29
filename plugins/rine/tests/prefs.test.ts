import { test, expect } from 'claude-code/testing'
import { seal } from '../hooks/lib/envelope'
import {
  DEFAULT_PREFS,
  hasLegacyPause,
  isMuted,
  legacyPausePath,
  muteDeadline,
  readPrefs,
  updatePrefs,
  withMute,
  withPreview
} from '../hooks/lib/prefs'
import { statePath } from '../hooks/lib/refs'
import { DIR } from './entry-kit'
import { createKit, splice } from './kit'

const PATH = statePath(DIR, 'prefs')
const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime()
const HOUR = 3600000

test('test_readPrefs_absentFile_isDefaults', async () => {
  expect(await readPrefs(createKit().ports, DIR)).toEqual(DEFAULT_PREFS)
})

test('test_updatePrefs_foreverMute_roundTrips', async () => {
  const kit = createKit()
  const out = await kit.clock.settle(updatePrefs(kit.ports, DIR, (p) => withMute(p, 'forever')))
  expect(out.status).toBe('ok')
  expect(await readPrefs(kit.ports, DIR)).toEqual({ mutedUntil: 'forever', isMuteExplicit: true, isPreview: false, isMotion: true })
})

test('test_updatePrefs_previewToggle_keepsMuteChoice', async () => {
  const kit = createKit()
  await kit.clock.settle(updatePrefs(kit.ports, DIR, (p) => withMute(p, NOW + HOUR)))
  await kit.clock.settle(updatePrefs(kit.ports, DIR, (p) => withPreview(p, true)))
  expect(await readPrefs(kit.ports, DIR)).toEqual({ mutedUntil: NOW + HOUR, isMuteExplicit: true, isPreview: true, isMotion: true })
})

test('test_updatePrefs_readBackMismatch_retriesOnce', async () => {
  const kit = createKit()
  await kit.clock.settle(updatePrefs(kit.ports, DIR, (p) => withPreview(p, true)))
  const current = kit.fs.files.get(PATH) ?? ''
  kit.fs.injectReads(PATH, [current, await seal('{"mutedUntil":null,"isMuteExplicit":false,"isPreview":false}')])
  const out = await kit.clock.settle(updatePrefs(kit.ports, DIR, (p) => withMute(p, 'forever')))
  expect(out.status).toBe('ok')
  expect((await readPrefs(kit.ports, DIR)).mutedUntil).toBe('forever')
})

test('test_readPrefs_tornTwice_keepsPrevious', async () => {
  const kit = createKit()
  const previous = withMute(DEFAULT_PREFS, 'forever')
  const torn = splice(await seal('{"mutedUntil":null,"isMuteExplicit":true}'), await seal('{"mutedUntil":5,"isMuteExplicit":false}'))
  kit.fs.injectReads(PATH, [torn, torn])
  expect(await kit.clock.settle(readPrefs(kit.ports, DIR, previous))).toEqual(previous)
})

test('test_muteDeadline_hourSpecs_addFromNow', () => {
  expect(muteDeadline('1h', NOW)).toBe(NOW + HOUR)
  expect(muteDeadline('8h', NOW)).toBe(NOW + 8 * HOUR)
  expect(muteDeadline('forever', NOW)).toBe('forever')
})

test('test_muteDeadline_offHoursAfterEight_isNextMorning', () => {
  expect(muteDeadline('off-hours', NOW)).toBe(new Date(2026, 9, 3, 8, 0, 0).getTime())
})

test('test_muteDeadline_offHoursBeforeEight_isSameMorning', () => {
  const early = new Date(2026, 9, 2, 6, 30, 0).getTime()
  expect(muteDeadline('off-hours', early)).toBe(new Date(2026, 9, 2, 8, 0, 0).getTime())
})

test('test_isMuted_legacyPauseWithoutExplicitChoice_mutes', () => {
  expect(isMuted(DEFAULT_PREFS, NOW, true)).toBe(true)
  expect(isMuted(DEFAULT_PREFS, NOW, false)).toBe(false)
  expect(isMuted(withPreview(DEFAULT_PREFS, true), NOW, true)).toBe(true)
})

test('test_isMuted_explicitUnmute_ignoresLegacyPause', () => {
  expect(isMuted(withMute(DEFAULT_PREFS, null), NOW, true)).toBe(false)
})

test('test_isMuted_timedMute_endsAtDeadline', () => {
  const prefs = withMute(DEFAULT_PREFS, NOW + HOUR)
  expect(isMuted(prefs, NOW, false)).toBe(true)
  expect(isMuted(prefs, NOW + HOUR, false)).toBe(false)
  expect(isMuted(withMute(DEFAULT_PREFS, 'forever'), NOW + 99 * HOUR, false)).toBe(true)
})

test('test_hasLegacyPause_readsTheMonitorPauseFile', async () => {
  const kit = createKit()
  expect(await hasLegacyPause(kit.ports, DIR)).toBe(false)
  kit.fs.files.set(legacyPausePath(DIR), '')
  expect(legacyPausePath(DIR)).toBe('/rine/monitor-pause')
  expect(await hasLegacyPause(kit.ports, DIR)).toBe(true)
})
