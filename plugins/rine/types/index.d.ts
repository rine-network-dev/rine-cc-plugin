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
}
export type RineListEntry = { kind: 'agent' | 'group'; handle: string; agentId: string | null }
export type RineLists = { allow: RineListEntry[]; deny: RineListEntry[] }
export type RinePreview = {
  status: 'loading' | 'ok' | 'error'
  text?: string
  isVerified?: boolean
  hiddenChars?: number
  truncatedChars?: number
}
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
    }
  }
}
