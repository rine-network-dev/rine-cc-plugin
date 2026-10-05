import type { Ports } from './ports'
import { statePath } from './refs'
import { isSet, nonEmpty } from './narrow'
import type { RineIdentity, RineMode } from '../../types/index'

export const RINE_CLI_TESTED_FLOOR = '0.20.0'

export type ModeEnv = {
  rineConfigDir: string | undefined
  home: string | undefined
  cwd: string
  isInteractive: boolean
}

export type Detected = { mode: RineMode; identity: RineIdentity }

export type PromptEvent = { permission_mode?: string; agent_id?: string }

const VERSION = /^\d+\.\d+\.\d+$/

export async function resolveRineDir(ports: Pick<Ports, 'fs'>, env: ModeEnv): Promise<string> {
  const explicit = env.rineConfigDir
  if (isSet(explicit)) return explicit
  const home = env.home
  if (isSet(home) && (await ports.fs.exists(`${home}/.config/rine/credentials.json`))) {
    return `${home}/.config/rine`
  }
  if (await ports.fs.exists(`${env.cwd}/.rine/credentials.json`)) return `${env.cwd}/.rine`
  return isSet(home) ? `${home}/.config/rine` : `${env.cwd}/.rine`
}

export function parseCliVersion(stdout: string): string | null {
  const raw = stdout.trim()
  const cut = raw.indexOf('-')
  const version = cut < 0 ? raw : raw.slice(0, cut)
  return VERSION.test(version) ? version : null
}

export function isBelowFloor(version: string | null): boolean {
  if (version === null) return false
  const have = version.split('.').map(Number)
  const want = RINE_CLI_TESTED_FLOOR.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const h = have[i] ?? 0
    const w = want[i] ?? 0
    if (h < w) return true
    if (h > w) return false
  }
  return false
}

async function readIdentity(ports: Pick<Ports, 'run'>, dir: string): Promise<Pick<RineIdentity, 'handle' | 'agentId'>> {
  try {
    const result = await ports.run(['rine', '--json', 'whoami'], {
      timeoutMs: 5000,
      env: { RINE_CONFIG_DIR: dir }
    })
    if (result.exitCode !== 0) return { handle: null, agentId: null }
    const value: unknown = JSON.parse(result.stdout)
    if (typeof value !== 'object' || value === null) return { handle: null, agentId: null }
    const record = value as Record<string, unknown>
    return { handle: nonEmpty(record.agent), agentId: nonEmpty(record.agent_id) }
  } catch {
    return { handle: null, agentId: null }
  }
}

export async function detectMode(ports: Ports, env: ModeEnv): Promise<Detected> {
  if (!env.isInteractive) {
    const dir = await resolveRineDir(ports, env)
    return {
      // No credentials: the unregistered guidance, never "connected". Still no run and no write.
      mode: (await ports.fs.exists(`${dir}/credentials.json`)) ? 'headless' : 'unregistered',
      identity: {
        handle: null,
        agentId: null,
        configDir: dir,
        cliVersion: null,
        isBelowFloor: false,
        isStateWritable: true
      }
    }
  }
  const dir = await resolveRineDir(ports, env)
  let isStateWritable = true
  try {
    await ports.fs.write(statePath(dir, 'probe'), '1')
  } catch {
    isStateWritable = false
  }
  let cliVersion: string | null = null
  try {
    const result = await ports.run(['rine', '--version'], { timeoutMs: 5000, env: { RINE_CONFIG_DIR: dir } })
    if (result.exitCode === 0) cliVersion = parseCliVersion(result.stdout)
  } catch {
    return {
      mode: 'mcp-only',
      identity: {
        handle: null,
        agentId: null,
        configDir: dir,
        cliVersion: null,
        isBelowFloor: false,
        isStateWritable
      }
    }
  }
  const isBelow = isBelowFloor(cliVersion)
  if (!(await ports.fs.exists(`${dir}/credentials.json`))) {
    return {
      mode: 'unregistered',
      identity: { handle: null, agentId: null, configDir: dir, cliVersion, isBelowFloor: isBelow, isStateWritable }
    }
  }
  const identity = await readIdentity(ports, dir)
  return {
    mode: 'ready',
    identity: { ...identity, configDir: dir, cliVersion, isBelowFloor: isBelow, isStateWritable }
  }
}

export function permissionModeFrom(event: PromptEvent, current: string | null): string | null {
  if (nonEmpty(event.agent_id) !== null) return current
  return nonEmpty(event.permission_mode) ?? current
}
