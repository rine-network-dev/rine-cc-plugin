import type { RineDisposition, RineEntry, RineList, RineLists } from '../../types/index'
import type { StreamMessage } from './frames'
import { matchLists, type Sender } from './lists'

export const BYPASS_MODE = 'bypassPermissions'
/** The relay's own event type. The server lets any agent send it to itself, so it earns no trust of its own. */
const WEBHOOK_TYPE = 'rine.v1.webhook'

/** True for a webhook-typed message this agent sent to itself; it wakes only when the user's own handle is allowlisted. */
function isSelfWebhook(message: StreamMessage, ownAgentId: string | null): boolean {
  return ownAgentId !== null && message.fromAgentId === ownAgentId && message.type === WEBHOOK_TYPE
}

export type Action = 'drop' | 'filter' | 'hold' | 'backlog' | 'mute' | 'notify' | 'wake'
export type Intent = { action: Action; list: RineList; reboundHandle: string | null; isWebhook: boolean }

export type RouteContext = {
  ownAgentId: string | null
  lists: RineLists
  isPreview: boolean
  isMuted: boolean
  isBacklog: boolean
}

/** What `rine --json read` said about a message; both null when the read did not complete. */
export type Verification = { status: string | null; fromAgentId: string | null }

export type Downgrade =
  | 'not-allowlisted'
  | 'denied'
  | 'muted'
  | 'preview'
  | 'not-owner'
  | 'not-interactive'
  | 'state-readonly'
  | 'lists-untrusted'
  | 'mode-unknown'
  | 'bypass'
  | 'not-inbound'
  | 'pending'
  | 'cooldown'
  | 'rate-limit'
  | 'unverified'

export type WakeChecks = {
  /** The sender's list match now, not at arrival: a deny or an un-allow made since must stop the wake. */
  list: RineList
  isMuted: boolean
  isPreview: boolean
  isOwner: boolean
  isInteractive: boolean
  isStateWritable: boolean
  isListsTrusted: boolean
  permissionMode: string | null
  isInbound: boolean
  isPending: boolean
  cooldownUntil: number | null
  now: number
  isRateAllowed: boolean
  fromAgentId: string
  ownAgentId: string | null
  /** null until `read` has been asked; `gateWake` then answers `verify`. */
  verification: Verification | null
}

export type WakeDisposition = { kind: 'wake' } | { kind: 'verify' } | { kind: 'notify'; reason: Downgrade }

const DISPOSITIONS: Record<Exclude<Action, 'drop'>, RineDisposition> = {
  filter: 'silent',
  hold: 'held',
  backlog: 'backlog',
  mute: 'silent',
  notify: 'notified',
  wake: 'notified'
}

export function senderOf(message: StreamMessage): Sender {
  return {
    handle: message.senderHandle,
    agentId: message.fromAgentId,
    groupHandle: message.groupHandle,
    groupId: message.groupId
  }
}

/** Routing: deny, preview, backlog, mute, then allow over neither; a self-addressed webhook is never dropped but wakes only when its sender is allowlisted. */
export function route(message: StreamMessage, ctx: RouteContext): Intent {
  const isWebhook = isSelfWebhook(message, ctx.ownAgentId)
  if (!isWebhook && (message.direction === 'sent' || message.fromAgentId === ctx.ownAgentId)) {
    return { action: 'drop', list: 'none', reboundHandle: null, isWebhook: false }
  }
  const match = matchLists(ctx.lists, senderOf(message))
  const intent = (action: Action): Intent => ({ action, list: match.list, reboundHandle: match.reboundHandle, isWebhook })
  if (match.list === 'deny') return intent('filter')
  if (ctx.isPreview) return intent('hold')
  if (ctx.isBacklog) return intent('backlog')
  if (ctx.isMuted) return intent('mute')
  return intent(match.list === 'allow' ? 'wake' : 'notify')
}

/** The ledger entry a routed message becomes; null for a dropped one (nothing is recorded). */
export function toEntry(message: StreamMessage, intent: Intent, now: number): RineEntry | null {
  if (intent.action === 'drop') return null
  return {
    id: message.id,
    from: message.senderHandle ?? message.fromAgentId,
    fromAgentId: message.fromAgentId,
    group: message.groupHandle,
    groupId: message.groupId,
    type: message.type,
    conversationId: message.conversationId,
    encryption: message.encryption,
    createdAt: message.createdAt ?? new Date(now).toISOString(),
    receivedAt: now,
    list: intent.list,
    disposition: DISPOSITIONS[intent.action],
    state: 'unread',
    isWebhook: intent.isWebhook,
    rowIndex: null
  }
}

function permissionDowngrade(mode: string | null): Downgrade | null {
  if (mode === null) return 'mode-unknown'
  return mode === BYPASS_MODE ? 'bypass' : null
}

function firstFailure(checks: WakeChecks): Downgrade | null {
  if (checks.list === 'deny') return 'denied'
  if (checks.list !== 'allow') return 'not-allowlisted'
  if (checks.isPreview) return 'preview'
  if (checks.isMuted) return 'muted'
  if (!checks.isOwner) return 'not-owner'
  if (!checks.isInteractive) return 'not-interactive'
  if (!checks.isStateWritable) return 'state-readonly'
  if (!checks.isListsTrusted) return 'lists-untrusted'
  const permission = permissionDowngrade(checks.permissionMode)
  if (permission !== null) return permission
  if (!checks.isInbound) return 'not-inbound'
  if (checks.isPending) return 'pending'
  if (checks.cooldownUntil !== null && checks.now < checks.cooldownUntil) return 'cooldown'
  return checks.isRateAllowed ? null : 'rate-limit'
}

/** Every downgrade that can stop a wake. `verify` asks the caller to run `read` and call again with its answer. */
export function gateWake(intent: Intent, checks: WakeChecks): WakeDisposition {
  if (intent.action !== 'wake') return { kind: 'notify', reason: 'not-allowlisted' }
  const failure = firstFailure(checks)
  if (failure !== null) return { kind: 'notify', reason: failure }
  const verification = checks.verification
  if (verification === null) return { kind: 'verify' }
  const isVerified =
    verification.status === 'verified' &&
    verification.fromAgentId === checks.fromAgentId &&
    (!intent.isWebhook || verification.fromAgentId === checks.ownAgentId)
  return isVerified ? { kind: 'wake' } : { kind: 'notify', reason: 'unverified' }
}
