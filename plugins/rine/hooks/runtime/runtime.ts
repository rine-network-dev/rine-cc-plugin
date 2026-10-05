import type { UiEnv } from '../ui/pane-actions'
import type { CompleteEvent, StepEvent, TurnEvent } from '../lib/delivery-wake'
import { checkToolCall, type GuardInput, type GuardVerdict } from '../lib/guard'
import { readToolTarget } from '../lib/ledger'
import { composeSection } from '../lib/model-text'
import { permissionModeFrom, resolveRineDir, type PromptEvent } from '../lib/mode'
import { isMuted } from '../lib/prefs'
import type { Host, StartInfo } from './host'
import { createMemory, initialMem, OFF_STREAM } from './memory'
import { createSession, type Session } from './session'
import { createUiEnv } from './ui-env'

export type Runtime = {
  ui: UiEnv
  /** Records the session's facts and boots; later calls only retry what is missing. */
  start: (info: StartInfo) => void
  ensure: () => void
  /** `session.end`: `clear` and `resume` change nothing. */
  end: (reason: string) => Promise<void>
  /** The `rine:` section of the system prompt, or null until the mode is known. */
  compose: () => Promise<string | null>
  turnStart: (event: TurnEvent) => Promise<void>
  turnStep: (event: StepEvent) => void
  turnComplete: (event: CompleteEvent) => Promise<void>
  /** Records the mode of a main-loop prompt. */
  prompt: (event: PromptEvent) => void
  /** The verdict on one write-class tool call. */
  guard: (input: GuardInput) => Promise<GuardVerdict>
  /** Marks the entry a successful `rine_read` call named. */
  readMarked: (tool: string, input: Record<string, unknown>) => Promise<void>
}

/** A fresh module resets the volatile state before anything runs. */
export function createRuntime(host: Host): Runtime {
  const mem = createMemory(initialMem(), host.publish, host.backend.log)
  mem.set({ stream: OFF_STREAM, isOwner: false, pendingWake: false })
  const session: Session = createSession(host, mem)
  const { ports } = session.core
  const delivery = () => session.core.live()?.delivery

  return {
    ui: createUiEnv(session),
    start: session.start,
    ensure: session.ensure,
    end: async (reason) => {
      if (reason !== 'clear' && reason !== 'resume') await session.stop()
    },
    compose: async () => {
      const m = mem.get()
      if (m.isDetecting || m.identity.configDir === '') return null
      return composeSection({
        mode: m.mode,
        handle: m.identity.handle,
        isPreview: m.prefs.isPreview,
        isMuted: isMuted(m.prefs, await ports.clock.now(), m.isLegacyPaused),
        cliVersion: m.identity.cliVersion,
        isBelowFloor: m.identity.isBelowFloor
      })
    },
    turnStart: async (event) => delivery()?.turnStart(event),
    turnStep: (event) => delivery()?.turnStep(event),
    turnComplete: async (event) => delivery()?.turnComplete(event),
    prompt: (event) => {
      const next = permissionModeFrom(event, mem.get().permissionMode)
      if (next !== mem.get().permissionMode) mem.set({ permissionMode: next })
    },
    guard: async (input) => {
      const home = await host.env('home')
      const env = { rineConfigDir: await host.env('rineConfigDir'), home, cwd: await host.cwd(), isInteractive: true }
      const live = await resolveRineDir(ports, env)
      const rineDirs = [...new Set([live, mem.get().identity.configDir].filter((dir) => dir !== ''))]
      return checkToolCall(host.realPath, { rineDirs, claudeConfigDir: await host.env('claudeConfigDir'), home }, input)
    },
    readMarked: async (tool, input) => {
      const id = readToolTarget(tool, input)
      if (id !== null) await session.markRead([id])
    }
  }
}
