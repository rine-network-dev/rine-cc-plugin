import type { Register } from 'claude-code'
import type { RineOrgStatus } from '../types/index'
import { resolveRineDir } from './lib/mode'
import { createOrgFeed, type OrgFeed, type OrgFeedFrame, type OrgFeedStatus } from './lib/org-feed'
import { orgFeedEnv } from './lib/org-feed-config'
import type { OrgAckStore } from './lib/org-ack'
import type { OrgIdentity } from './lib/org-frames'
import { addOrgFinding } from './lib/org-findings'
import { addOrgRow, emptyOrgStore, type OrgStore } from './lib/org-window'
import { portsFrom, type Ports } from './lib/ports'
import type { Host } from './runtime/host'
import { INBOX_PANE } from './ui/pane-actions'
import { ORG_STATUS_IDLE, type OrgTabEnv } from './ui/org-tab'

/** What the org wiring reaches of the engine: functions the module's own file builds over `$`, never `$` itself. */
export type OrgHost = {
  host: Host
  ack: OrgAckStore
  /** Writes the status to `$.state` and bumps the redraw counter. */
  draw: (status: RineOrgStatus) => Promise<unknown>
}

type Bound = OrgHost & { ports: Ports }

const NOT_READY = 'rine: the org view is not ready yet'
const START_FAILED = 'The org view could not start. Check your rine setup, then press r to try again.'

/** Rows that stand as gaps in a store: what the header counts. */
function gapsIn(store: OrgStore): number {
  let gaps = 0
  for (const row of store.rows.values()) if (row.message.gap !== null) gaps += 1
  return gaps
}

export type Org = {
  /** What the org tab draws and presses. */
  env: OrgTabEnv
  /** Takes the engine from the first event; `make` runs once. */
  bind: (make: () => OrgHost) => void
  /** `session.end`: `clear` and `resume` change nothing, as for the runtime. */
  end: (reason: string) => void
  stop: () => void
}

/**
 * The org tab's wiring: the feed starts when the tab asks for it and stops when the tab, the pane or the session
 * ends. Messages stay in this closure's store, never in `$.state`; the
 * acknowledgement lives in `$.store`.
 */
export function createOrg(): Org {
  let store = emptyOrgStore()
  let sentence: string | null = null
  let status: RineOrgStatus = ORG_STATUS_IDLE
  let bound: Bound | null = null
  let feed: OrgFeed | null = null
  let isWanted = false
  let writes: Promise<unknown> = Promise.resolve()
  let isQueued = false

  const ready = (): Bound => {
    if (bound === null) throw new Error(NOT_READY)
    return bound
  }

  /** Writes the status and the redraw counter in order, one write for a burst of frames; a failed write is logged, never thrown. */
  const show = (): void => {
    const b = bound
    if (b === null || isQueued) return
    isQueued = true
    writes = writes
      .then(async () => {
        isQueued = false
        await b.draw(status)
      })
      .catch(() => b.host.backend.log('rine: org state write failed'))
  }
  const counts = () => ({ loaded: store.order.length, gaps: gapsIn(store) })

  const onFrame = (frame: OrgFeedFrame): void => {
    if (frame.kind === 'row') addOrgRow(store, frame)
    else if (frame.kind === 'finding') addOrgFinding(store, frame)
    else if (frame.kind !== 'page') return
    else if (frame.pageKind !== 'poll') store.olderCursor = frame.olderCursor
    status = { ...status, ...counts() }
    show()
  }
  const onOrg = (org: OrgIdentity | null): void => {
    store.org = org
    show()
  }
  const onStatus = ({ phase, reason, sentence: said }: OrgFeedStatus): void => {
    sentence = said
    status = { phase, reason, ...counts() }
    show()
  }

  /** The feed is built once, over the config dir the session resolves as its own. */
  async function begin(b: Bound): Promise<void> {
    if (feed === null) {
      const { host } = b
      const dir = await resolveRineDir(b.ports, {
        rineConfigDir: await host.env('rineConfigDir'),
        home: await host.env('home'),
        cwd: await host.cwd(),
        isInteractive: true
      })
      const env = orgFeedEnv(dir, await host.env('ownerDir'))
      feed ??= createOrgFeed(b.ports, { spawn: host.spawn, after: host.after, log: host.backend.log }, { onFrame, onOrg, onStatus }, env)
    }
    if (isWanted) feed.start()
  }

  /** A start that fails shows the stopped tab with a sentence, never the acknowledgement screen again. */
  const launch = (b: Bound): void => {
    void begin(b).catch(() => {
      b.host.backend.log('rine: org feed did not start')
      onStatus({ phase: 'stopped', reason: null, sentence: START_FAILED })
    })
  }

  /** Leaving the tab drops the decrypted rows with the feed; a reopen reads again. */
  const stop = (): void => {
    isWanted = false
    feed?.stop()
    store = emptyOrgStore()
  }

  const bind = (make: () => OrgHost): void => {
    if (bound !== null) return
    const made = make()
    bound = { ...made, ports: portsFrom(made.host.backend) }
    if (isWanted) launch(bound)
  }

  return {
    bind,
    stop,
    end: (reason) => {
      if (reason !== 'clear' && reason !== 'resume') stop()
    },
    env: {
      store: () => store,
      sentence: () => sentence,
      ack: {
        load: async (key) => ready().ack.load(key),
        save: async (key, value) => ready().ack.save(key, value)
      },
      feed: {
        start: () => {
          isWanted = true
          if (bound !== null) launch(bound)
        },
        stop,
        loadOlder: async (cursor) => feed?.loadOlder(cursor)
      }
    }
  }
}

/** The pane's close ends the feed, as does leaving the tab. */
export function registerOrg(on: Parameters<Register>[0], org: Org): void {
  on('ui.close', async (_$, e, next) => {
    if (e.id === INBOX_PANE.id) org.stop()
    return next(e)
  })
}
