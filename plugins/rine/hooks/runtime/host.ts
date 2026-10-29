import type { PluginState } from 'claude-code'
import type { RealPath } from '../lib/guard'
import type { Backend } from '../lib/ports'
import type { PreviewSetter } from '../lib/preview'
import type { SpawnStream } from '../lib/supervisor-run'

export type Published = Partial<PluginState['rine']>
export type Recalled = Pick<Published, 'entries' | 'mirrorSince' | 'leaseNonce' | 'permissionMode'>
export type EnvName = 'rineConfigDir' | 'home' | 'claudeConfigDir' | 'ownerDir'
export type Cancel = () => void

/** Everything the runtime takes from the engine, as plain functions: `register.tsx` is the only file that holds `$`. */
export type Host = {
  backend: Backend
  env: (name: EnvName) => Promise<string | undefined>
  publish: (patch: Published) => Promise<void>
  /** What `$.state` kept across a reload of this module. */
  recall: () => Promise<Recalled>
  setPreview: PreviewSetter
  realPath: RealPath
  /** The `$.store` digests of a lists-trust key. */
  loadDigests: (key: string) => Promise<readonly string[]>
  saveDigests: (key: string, digests: readonly string[]) => Promise<void>
  spawn: (argv: readonly string[], env: Record<string, string>) => SpawnStream
  every: (ms: number, fn: () => void) => Cancel
  after: (ms: number, fn: () => void) => Cancel
  status: (text: string | undefined) => void
  sessionId: () => Promise<string>
  cwd: () => Promise<string>
}

export type StartInfo = { cwd: string; isInteractive: boolean }
