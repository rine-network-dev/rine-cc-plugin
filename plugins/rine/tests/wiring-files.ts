import { statePath, type StateFile } from '../hooks/lib/refs'
import { CFG, type World } from './wiring-kit'

export const pathOf = (file: StateFile): string => statePath(CFG, file)

/** The JSON body of a sealed state file the plugin wrote (`<digest>\n<json>`). */
export function bodyOf<T>(world: World, file: StateFile): T {
  const text = world.files.get(pathOf(file)) ?? ''
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as T
}

export type LeaseBody = { nonce: string; agentId: string; sessionId: string; heartbeatAt: number; releasedAt: number | null; wakes: number[] }
