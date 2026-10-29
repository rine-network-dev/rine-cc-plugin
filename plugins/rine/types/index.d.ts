export type RineMode = 'ready' | 'unregistered' | 'mcp-only' | 'headless'
export type RinePhase = 'off' | 'connecting' | 'live' | 'stale' | 'backoff' | 'offline' | 'auth-failed' | 'peer'
export type RineStream = {
  phase: RinePhase
  attempt: number
  lastFrameAt: number | null
  nextRetryAt: number | null
  ownerCwd: string | null
  unreadable: number
}
export type RineIdentity = {
  handle: string | null
  agentId: string | null
  configDir: string
  cliVersion: string | null
  isBelowFloor: boolean
  isStateWritable: boolean
}
export type RineList = 'allow' | 'deny' | 'none'
export type RineDisposition = 'notified' | 'woken' | 'held' | 'silent' | 'backlog' | 'handed'
export type RineEntry = {
  id: string
  from: string
  fromAgentId: string
  group: string | null
  groupId: string | null
  type: string
  conversationId: string | null
  encryption: string | null
  createdAt: string
  receivedAt: number
  list: RineList
  disposition: RineDisposition
  state: 'unread' | 'read'
  rowIndex: number | null
  /** A self-addressed rine.v1.webhook event: the one entry whose sender is this agent itself. */
  isWebhook: boolean
}
export type RinePrefs = {
  mutedUntil: number | 'forever' | null
  isMuteExplicit: boolean
  isPreview: boolean
  /** Cell animation on the terminal: pulse, spinner, shimmer, reveal and decode. `/rine motion off` stores false. */
  isMotion: boolean
}
export type RineListEntry = { kind: 'agent' | 'group'; handle: string; agentId: string | null }
export type RineLists = { allow: RineListEntry[]; deny: RineListEntry[] }
/** What `$.state` keeps of a preview: flags and counts. The decrypted text stays in the plugin's module memory, because every installed plugin can read `$.state`. */
export type RinePreview = {
  status: 'loading' | 'ok' | 'error'
  isVerified?: boolean
  hiddenChars?: number
  truncatedChars?: number
}
export type RineOrgTab = 'inbox' | 'org'
/** `ack`: the one-time acknowledgement is showing and no feed is running. */
export type RineOrgPhase = 'idle' | 'ack' | 'starting' | 'live' | 'paused' | 'stopped'
/** The feed's error codes, plus `cli_too_old` for a CLI that predates the feed. */
export type RineOrgStopReason =
  | 'needs_org_key'
  | 'no_identity'
  | 'auth_refused'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'malformed_page'
  | 'cli_too_old'
export type RineOrgStatus = { phase: RineOrgPhase; reason: RineOrgStopReason | null; loaded: number; gaps: number }
declare module 'claude-code' {
  interface PluginState {
    rine: {
      mode: RineMode
      identity: RineIdentity
      stream: RineStream
      entries: RineEntry[]
      prefs: RinePrefs
      lists: RineLists
      listsDigest: string | null
      isListsTrusted: boolean
      isOwner: boolean
      isLegacyPaused: boolean
      groupWarnId: string | null
      isBusy: boolean
      pendingWake: boolean
      wakeCooldownUntil: number | null
      permissionMode: string | null
      leaseNonce: string | null
      mirrorSince: number
      preview: StateFamily<RinePreview>
      isSelected: StateFamily<boolean>
      isRawShown: StateFamily<boolean>
      replyDraft: StateFamily<string>
      focusId: string | null
      /** Ids of the unread entries the person has seen announced: the band draws only for those not in it, and the prompt line carries the rest. */
      foldedIds: string[]
      orgTab: RineOrgTab
      orgStatus: RineOrgStatus
      orgRev: number
    }
  }
}
