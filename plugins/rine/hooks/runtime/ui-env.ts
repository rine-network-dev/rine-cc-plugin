import { confirmLists, readLists, updateLists } from '../lib/lists'
import { hasLegacyPause, updatePrefs } from '../lib/prefs'
import { createReader, loadPreview } from '../lib/preview'
import type { UiEnv } from '../ui/pane-actions'
import type { Session } from './session'

/** What the band, pane and /rine reach beyond `$.state`, over the live session. Before the mode is ready each edit reports `failed`. */
export function createUiEnv(session: Session): UiEnv {
  const { ports, mem, host } = session.core
  const reader = createReader(ports.run)
  const dir = (): string => mem.get().identity.configDir

  return {
    now: () => ports.clock.now(),
    handOff: async (ids) => {
      const live = session.core.live()
      if (live === null) return { status: 'empty' }
      const result = await live.delivery.handOff(ids)
      if (result.status === 'submitted' || result.status === 'queued') await session.ask('handed', ids)
      return result
    },
    markRead: session.markRead,
    loadPreview: async (id) => {
      await loadPreview(reader, host.setPreview, id, dir())
    },
    editPrefs: async (edit) => {
      if (dir() === '') return 'failed'
      const done = await updatePrefs(ports, dir(), edit, mem.get().prefs)
      if (done.status === 'ok') mem.set({ prefs: done.value })
      return done.status
    },
    editLists: async (edit) => {
      const live = session.core.live()
      if (live === null) return 'failed'
      const done = await updateLists(ports, live.trust, dir(), edit, mem.get().lists)
      if (done.status !== 'ok') return done.status
      const view = await readLists(ports, live.trust, dir(), mem.get().lists)
      mem.set({ lists: view })
      return view.isTrusted ? 'ok' : 'untrusted'
    },
    confirmLists: async () => {
      const live = session.core.live()
      const view = live === null ? null : await confirmLists(ports, live.trust, dir())
      if (view !== null) mem.set({ lists: view })
      return view !== null
    },
    hasLegacyPause: () => hasLegacyPause(ports, dir()),
    reconnect: async () => session.reconnect(),
    takeover: session.takeover
  }
}

/** The env the UI registers at load, before any event has built the runtime; each call reaches the runtime built since. */
export function delegateUi(current: () => UiEnv | null): UiEnv {
  const ui = (): UiEnv => {
    const env = current()
    if (env === null) throw new Error('rine: the inbox is not ready yet')
    return env
  }
  return {
    now: () => ui().now(),
    handOff: (ids) => ui().handOff(ids),
    markRead: (ids) => ui().markRead(ids),
    loadPreview: (id) => ui().loadPreview(id),
    editPrefs: (edit) => ui().editPrefs(edit),
    editLists: (edit) => ui().editLists(edit),
    confirmLists: () => ui().confirmLists(),
    hasLegacyPause: () => ui().hasLegacyPause(),
    reconnect: () => ui().reconnect(),
    takeover: () => ui().takeover()
  }
}
