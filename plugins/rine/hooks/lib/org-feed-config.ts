import type { RineOrgStopReason } from '../../types/index'

export const FEED_ARGV = ['rine', 'tui', '--feed', '--poll', '10'] as const
export const ONCE_ARGV = ['rine', 'tui', '--feed', '--once', '--before'] as const

/** The feed's exit codes (`FeedExit` in the CLI's feed-schema.ts; the plugin cannot import the CLI, so a test pins them to the generated contract). */
export const EXIT_NO_IDENTITY = 3
export const EXIT_REFUSED = 4

export const HELLO_TIMEOUT_MS = 10000

/** Every code the feed can report; the record type fails to compile when it and `RineOrgStopReason` differ in either direction. */
const FEED_STOP_CODES: Record<Exclude<RineOrgStopReason, 'cli_too_old'>, true> = {
  needs_org_key: true,
  no_identity: true,
  auth_refused: true,
  rate_limited: true,
  network: true,
  server: true,
  malformed_page: true
}

export const stopReasonOf = (code: string | undefined): RineOrgStopReason | null =>
  Object.keys(FEED_STOP_CODES).find((reason): reason is RineOrgStopReason => reason === code) ?? null

/** The feed child's environment: the config dir, and the owner dir only when the session process already has it. */
export function orgFeedEnv(configDir: string, ownerDir: string | undefined): Record<string, string> {
  return ownerDir === undefined ? { RINE_CONFIG_DIR: configDir } : { RINE_CONFIG_DIR: configDir, RINE_OWNER_DIR: ownerDir }
}
