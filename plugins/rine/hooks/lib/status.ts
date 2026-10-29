import type { RineIdentity, RineMode, RineStream } from '../../types/index'
import { RINE_CLI_TESTED_FLOOR } from './mode'
import { safeLine } from './sanitize'
import { shownHandle } from './shown-handle'

export type StatusInput = {
  isDetecting: boolean
  mode: RineMode
  identity: RineIdentity
  stream: RineStream
  isMuted: boolean
  isPreview: boolean
  unread: number
  held: number
  now: number
  wokeAt: number | null
}

type FailurePhase = 'off' | 'connecting' | 'stale' | 'backoff' | 'offline' | 'auth-failed'

const WOKE_WINDOW_MS = 10000

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.ceil(ms / 3600000)}h`
}

function handleOf(identity: RineIdentity): string {
  return identity.handle === null ? 'unknown' : shownHandle(identity.handle, null, 32)
}

function suffixes(input: StatusInput, isLive: boolean): string {
  const { identity, stream, now, wokeAt } = input
  let text = ''
  if (identity.isBelowFloor && identity.cliVersion !== null) {
    text += ` · CLI ${safeLine(identity.cliVersion, 20)} < ${RINE_CLI_TESTED_FLOOR}`
  }
  if (!identity.isStateWritable) text += ' · state read-only'
  if (stream.unreadable > 0) text += ` · ${stream.unreadable} unreadable`
  if (isLive && wokeAt !== null && now - wokeAt < WOKE_WINDOW_MS) text += ' · woke Claude'
  return text
}

function failureText(phase: FailurePhase, stream: RineStream, now: number): string {
  switch (phase) {
    case 'connecting':
    case 'off':
      return 'rine \u25cc connecting\u2026'
    case 'backoff':
      return stream.nextRetryAt === null
        ? 'rine \u25cc reconnecting\u2026'
        : `rine \u25cc reconnecting in ${formatDuration(stream.nextRetryAt - now)}`
    case 'stale':
      return stream.lastFrameAt === null
        ? 'rine \u26a0 no signal'
        : `rine \u26a0 no signal for ${formatDuration(now - stream.lastFrameAt)}`
    case 'offline':
      return stream.nextRetryAt === null
        ? 'rine \u2715 offline · /rine reconnect'
        : `rine \u2715 offline · retry in ${formatDuration(stream.nextRetryAt - now)} · /rine reconnect`
    case 'auth-failed':
      return 'rine \u2715 auth failed · /rine-setup'
  }
}

function liveText(input: StatusInput): string {
  const { unread } = input
  if (input.isMuted) return `rine \u23f8 muted · ${unread} unread` + suffixes(input, true)
  if (input.isPreview) {
    const base = `rine \u25d0 preview · ${input.held} held`
    return (unread > 0 ? `${base} · ${unread} unread` : base) + suffixes(input, true)
  }
  const base = `rine \u25cf ${handleOf(input.identity)}`
  return (unread > 0 ? `${base} · ${unread} unread` : base) + suffixes(input, true)
}

export function statusText(input: StatusInput): string | undefined {
  if (input.isDetecting) return 'rine \u25cc starting\u2026'
  if (input.mode === 'headless') return undefined
  if (input.mode === 'unregistered') return 'rine · not registered · /rine-setup'
  if (input.mode === 'mcp-only') return 'rine · CLI missing (MCP only)'
  if (input.mode === 'ready' && input.identity.agentId === null) {
    return 'rine · identity unknown · retrying' + suffixes(input, false)
  }
  const { stream, now } = input
  const phase = stream.phase
  if (phase === 'peer') {
    const owner = stream.ownerCwd === null ? 'another session' : safeLine(stream.ownerCwd, 40)
    const text = `rine \u21c4 ${handleOf(input.identity)} · ${input.unread} unread · stream in ${owner}`
    return text + suffixes(input, false)
  }
  if (phase === 'live') return liveText(input)
  return failureText(phase, stream, now) + suffixes(input, false)
}
