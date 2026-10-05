export const MCP_SERVER = 'plugin:rine:rine'
export const TOOL_PATTERN = /^mcp__plugin_rine_rine__(rine_[a-z_]+)$/

export const STATE_FILES = {
  lease: 'lease.json',
  ledger: 'ledger.json',
  lists: 'lists.json',
  prefs: 'prefs.json',
  requests: 'requests.json',
  probe: '.probe',
} as const

export type StateFile = keyof typeof STATE_FILES

export function stateDir(rineDir: string): string {
  return `${rineDir}/state/cc`
}

export function statePath(rineDir: string, file: StateFile): string {
  return `${stateDir(rineDir)}/${STATE_FILES[file]}`
}
