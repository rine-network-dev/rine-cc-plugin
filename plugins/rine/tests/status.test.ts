import { test, expect } from 'claude-code/testing'
import type { RineIdentity, RineStream } from '../types/index'
import { formatDuration, statusText, type StatusInput } from '../hooks/lib/status'

type Overrides = Partial<Omit<StatusInput, 'identity' | 'stream'>> & {
  identity?: Partial<RineIdentity>
  stream?: Partial<RineStream>
}

function base(overrides: Overrides = {}): StatusInput {
  const { identity, stream, ...rest } = overrides
  return {
    isDetecting: false,
    mode: 'ready',
    identity: {
      handle: 'alice@acme',
      agentId: 'a-1',
      configDir: '/cfg',
      cliVersion: '0.20.0',
      isBelowFloor: false,
      isStateWritable: true,
      ...identity
    },
    stream: {
      phase: 'live',
      attempt: 0,
      lastFrameAt: null,
      nextRetryAt: null,
      ownerCwd: null,
      unreadable: 0,
      ...stream
    },
    isMuted: false,
    isPreview: false,
    unread: 0,
    held: 0,
    now: 1_000_000,
    wokeAt: null,
    ...rest
  }
}

test('test_statusText_detecting_showsStarting', async () => {
  expect(statusText(base({ isDetecting: true }))).toBe('rine \u25cc starting\u2026')
})

test('test_statusText_headless_isUndefined', async () => {
  expect(statusText(base({ mode: 'headless' }))).toBeUndefined()
})

test('test_statusText_unregistered_showsSetupHint', async () => {
  expect(statusText(base({ mode: 'unregistered' }))).toBe('rine · not registered · /rine-setup')
})

test('test_statusText_mcpOnly_showsCliMissing', async () => {
  expect(statusText(base({ mode: 'mcp-only' }))).toBe('rine · CLI missing (MCP only)')
})

test('test_statusText_readyWithoutAgentId_showsIdentityUnknown', async () => {
  expect(statusText(base({ identity: { agentId: null } }))).toBe('rine · identity unknown · retrying')
})

test('test_statusText_peer_showsHandleUnreadAndOwner', async () => {
  const owned = base({ stream: { phase: 'peer', ownerCwd: '/work/other' }, unread: 3 })
  expect(statusText(owned)).toBe('rine \u21c4 alice@acme · 3 unread · stream in /work/other')
  const unowned = base({ stream: { phase: 'peer', ownerCwd: null }, unread: 1 })
  expect(statusText(unowned)).toBe('rine \u21c4 alice@acme · 1 unread · stream in another session')
})

test('test_statusText_connectingOrOff_showsConnecting', async () => {
  expect(statusText(base({ stream: { phase: 'connecting' } }))).toBe('rine \u25cc connecting\u2026')
  expect(statusText(base({ stream: { phase: 'off' } }))).toBe('rine \u25cc connecting\u2026')
})

test('test_statusText_backoff_showsCountdown', async () => {
  const timed = base({ stream: { phase: 'backoff', nextRetryAt: 1_012_000 } })
  expect(statusText(timed)).toBe('rine \u25cc reconnecting in 12s')
  expect(statusText(base({ stream: { phase: 'backoff', nextRetryAt: null } }))).toBe('rine \u25cc reconnecting\u2026')
})

test('test_statusText_stale_showsSilenceDuration', async () => {
  const timed = base({ stream: { phase: 'stale', lastFrameAt: 820_000 } })
  expect(statusText(timed)).toBe('rine \u26a0 no signal for 3m')
  expect(statusText(base({ stream: { phase: 'stale', lastFrameAt: null } }))).toBe('rine \u26a0 no signal')
})

test('test_statusText_offline_showsRetryAndReconnect', async () => {
  const timed = base({ stream: { phase: 'offline', nextRetryAt: 1_240_000 } })
  expect(statusText(timed)).toBe('rine \u2715 offline · retry in 4m · /rine reconnect')
  const untimed = base({ stream: { phase: 'offline', nextRetryAt: null } })
  expect(statusText(untimed)).toBe('rine \u2715 offline · /rine reconnect')
})

test('test_statusText_authFailed_showsSetupHint', async () => {
  expect(statusText(base({ stream: { phase: 'auth-failed' } }))).toBe('rine \u2715 auth failed · /rine-setup')
})

test('test_statusText_liveMuted_showsMutedAndUnread', async () => {
  expect(statusText(base({ isMuted: true, unread: 4 }))).toBe('rine \u23f8 muted · 4 unread')
})

test('test_statusText_livePreview_showsHeldWithAndWithoutUnread', async () => {
  expect(statusText(base({ isPreview: true, held: 2 }))).toBe('rine \u25d0 preview · 2 held')
  expect(statusText(base({ isPreview: true, held: 2, unread: 3 }))).toBe('rine \u25d0 preview · 2 held · 3 unread')
})

test('test_statusText_live_showsHandleWithAndWithoutUnread', async () => {
  expect(statusText(base({ unread: 0 }))).toBe('rine \u25cf alice@acme')
  expect(statusText(base({ unread: 5 }))).toBe('rine \u25cf alice@acme · 5 unread')
})

test('test_statusText_liveWithoutHandle_saysUnknown', async () => {
  expect(statusText(base({ identity: { handle: null } }))).toBe('rine \u25cf unknown')
})

test('test_statusText_mutedAndPreview_mutedWins', async () => {
  expect(statusText(base({ isMuted: true, isPreview: true, unread: 1 }))).toBe('rine \u23f8 muted · 1 unread')
})

test('test_statusText_failurePhaseWithMuteAndPreview_hidesBoth', async () => {
  const input = base({ stream: { phase: 'offline', nextRetryAt: null }, isMuted: true, isPreview: true })
  expect(statusText(input)).toBe('rine \u2715 offline · /rine reconnect')
})

test('test_statusText_belowFloor_appendsCliSuffix', async () => {
  const input = base({ identity: { isBelowFloor: true, cliVersion: '0.19.0' } })
  expect(statusText(input)).toBe('rine \u25cf alice@acme · CLI 0.19.0 < 0.20.0')
})

test('test_statusText_stateReadOnly_appendsSuffix', async () => {
  expect(statusText(base({ identity: { isStateWritable: false } }))).toBe('rine \u25cf alice@acme · state read-only')
})

test('test_statusText_unreadable_appendsSuffix', async () => {
  expect(statusText(base({ stream: { unreadable: 2 } }))).toBe('rine \u25cf alice@acme · 2 unreadable')
})

test('test_statusText_wokeSuffix_shownWithinWindowAndGoneAtEdge', async () => {
  expect(statusText(base({ wokeAt: 990_001 }))).toBe('rine \u25cf alice@acme · woke Claude')
  expect(statusText(base({ wokeAt: 990_000 }))).toBe('rine \u25cf alice@acme')
})

test('test_statusText_wokeOnNonLivePhase_dropsSuffix', async () => {
  const input = base({ stream: { phase: 'connecting' }, wokeAt: 999_000 })
  expect(statusText(input)).toBe('rine \u25cc connecting\u2026')
})

test('test_statusText_unregisteredWithSuffixConditions_hasNoSuffixes', async () => {
  const input = base({
    mode: 'unregistered',
    identity: { isBelowFloor: true, cliVersion: '0.19.0', isStateWritable: false },
    stream: { unreadable: 3 }
  })
  expect(statusText(input)).toBe('rine · not registered · /rine-setup')
})

test('test_statusText_handleWithEscAndBidi_isScrubbed', async () => {
  expect(statusText(base({ identity: { handle: 'a\x1b[31mb\u202ec' } }))).toBe('rine \u25cf abc')
})

test('test_statusText_longHandle_isTruncatedTo32Cells', async () => {
  expect(statusText(base({ identity: { handle: 'x'.repeat(40) } }))).toBe('rine \u25cf ' + 'x'.repeat(31) + '\u2026')
})

test('test_formatDuration_underOneSecond_isZeroSeconds', async () => {
  expect(formatDuration(0)).toBe('0s')
  expect(formatDuration(-5)).toBe('0s')
})

test('test_formatDuration_oneMillisecond_roundsUpToOneSecond', async () => {
  expect(formatDuration(1)).toBe('1s')
})

test('test_formatDuration_justOverAMinute_roundsUpToOneMinute', async () => {
  expect(formatDuration(59001)).toBe('1m')
  expect(formatDuration(60000)).toBe('1m')
})

test('test_formatDuration_justOverAnHour_roundsUpToTwoHours', async () => {
  expect(formatDuration(3600001)).toBe('2h')
})
