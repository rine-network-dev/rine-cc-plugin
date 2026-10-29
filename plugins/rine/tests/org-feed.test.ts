import { test, expect } from 'claude-code/testing'
import { createOrgFeed, type OrgFeedFrame, type OrgFeedStatus } from '../hooks/lib/org-feed'
import { EXIT_NO_IDENTITY, EXIT_REFUSED, FEED_ARGV, HELLO_TIMEOUT_MS, orgFeedEnv } from '../hooks/lib/org-feed-config'
import type { OrgIdentity } from '../hooks/lib/org-frames'
import { at } from './at'
import { FEED_CONTRACT_EXIT } from './feed-contract'
import { createKit } from './kit'
import { createChild, type FakeChild } from './stream-kit'

const SECRET = 'plaintext-canary-7f3a'

type EndingChild = FakeChild & { end: (code: number | null) => void }

/** A FakeChild whose end carries the exit code the engine reports. */
function endingChild(): EndingChild {
  const child = createChild()
  const next = child.next
  let code: number | null = null
  child.next = async () => {
    const step = await next()
    return step.done ? { done: true, value: { code, signal: null } } : step
  }
  return Object.assign(child, {
    end: (exitCode: number | null) => {
      code = exitCode
      child.exit()
    }
  })
}

function line(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ event, data: { v: 1, ...data } }) + '\n'
}

const HELLO = line('hello', { principal: 'org', org_id: 'o-1', org: { name: 'Acme GmbH', slug: 'acme' }, poll_s: 10 })
const HEARTBEAT = line('heartbeat', { at: 'x', next_poll_s: 10, paused_s: null })
const PAGE = line('page', { kind: 'initial', count: 0, older_cursor: null })
const ERROR = (code: string): string => line('error', { code, sentence: `Sentence for ${code}.`, retry_s: null })
const ROW = line('row', {
  seq: 1,
  message: {
    id: 'm-1',
    created_at: '2026-10-24T10:00:00+00:00',
    type: 'rine.v1.dm',
    from: { agent_id: 'a1', handle: null, own: true },
    to: null,
    group: null,
    equivocation: false,
    gap: null
  },
  display: { glyph: '>', snippet: SECRET, from_short: 'a1', to_short: 'b2' },
  hidden_chars: 0,
  text_truncated: 0
})

function createRig(isSpawnFailing = false, isSinkThrowing = false) {
  const kit = createKit()
  const children: EndingChild[] = []
  const spawns: { argv: readonly string[]; env: Record<string, string> }[] = []
  const frames: OrgFeedFrame[] = []
  const statuses: OrgFeedStatus[] = []
  const orgs: (OrgIdentity | null)[] = []
  const logs: string[] = []
  const feed = createOrgFeed(
    kit.ports,
    {
      spawn: (argv, env) => {
        spawns.push({ argv, env })
        if (isSpawnFailing) throw new Error('spawn rine ENOENT')
        const child = endingChild()
        children.push(child)
        return child
      },
      after: (ms, fn) => {
        let isLive = true
        void kit.clock.sleep(ms).then(() => {
          if (isLive) fn()
        })
        return () => {
          isLive = false
        }
      },
      log: (text) => {
        logs.push(text)
      }
    },
    {
      onFrame: (frame) => {
        frames.push(frame)
        if (isSinkThrowing) throw new Error('sink boom')
      },
      onOrg: (org) => orgs.push(org),
      onStatus: (status) => statuses.push(status)
    },
    orgFeedEnv('/cfg', undefined)
  )
  return {
    kit,
    feed,
    children,
    spawns,
    frames,
    orgs,
    logs,
    statuses,
    step: (ms: number) => kit.clock.step(ms),
    status: () => at(statuses, statuses.length - 1)
  }
}

async function started(isSpawnFailing = false) {
  const rig = createRig(isSpawnFailing)
  rig.feed.start()
  await rig.step(0)
  return rig
}

async function live() {
  const rig = await started()
  at(rig.children, 0).write(HELLO)
  await rig.step(0)
  return rig
}

test('test_orgFeedEnv_ownerDirOnlyWhenTheSessionHasIt', () => {
  expect(orgFeedEnv('/cfg', undefined)).toEqual({ RINE_CONFIG_DIR: '/cfg' })
  expect(orgFeedEnv('/cfg', '/owner')).toEqual({ RINE_CONFIG_DIR: '/cfg', RINE_OWNER_DIR: '/owner' })
})

test('test_start_spawnsTheFeedWithTheConfigDirEnv', async () => {
  const rig = await started()
  expect(rig.spawns).toEqual([{ argv: FEED_ARGV, env: { RINE_CONFIG_DIR: '/cfg' } }])
  expect(rig.status()).toEqual({ phase: 'starting', reason: null, sentence: null })
})

test('test_stopExitCodes_matchTheCliFeedContract', () => {
  expect({ noIdentity: EXIT_NO_IDENTITY, refused: EXIT_REFUSED }).toEqual(FEED_CONTRACT_EXIT)
})

test('test_start_calledTwice_spawnsOnce', async () => {
  const rig = await started()
  rig.feed.start()
  await rig.step(0)
  expect(rig.children).toHaveLength(1)
})

test('test_hello_goesLive_andRowsPageAndErrorsReachTheSink', async () => {
  const rig = await live()
  expect(rig.status().phase).toBe('live')
  at(rig.children, 0).write(HEARTBEAT + ROW + PAGE + ERROR('rate_limited'))
  await rig.step(0)
  expect(rig.frames.map((frame) => frame.kind)).toEqual(['row', 'page', 'error'])
})

test('test_hello_namesTheOrgOnceToTheSink', async () => {
  const rig = await live()
  at(rig.children, 0).write(HELLO)
  await rig.step(0)
  expect(rig.orgs).toEqual([{ name: 'Acme GmbH', slug: 'acme' }])
})

test('test_unreadableAndOversizedLines_logTheReasonNeverTheLine', async () => {
  const rig = await live()
  const child = at(rig.children, 0)
  child.write(`{not json ${SECRET}\n`)
  child.write(JSON.stringify({ event: 'row', data: { v: 2, note: SECRET } }) + '\n')
  await rig.step(11000)
  child.write(SECRET.repeat(200000) + '\n')
  await rig.step(0)
  expect(rig.logs.length).toBeGreaterThan(0)
  expect(rig.logs.join('\n')).not.toContain(SECRET)
  expect(rig.logs.some((text) => text.includes('(json)') || text.includes('(version)'))).toBe(true)
  expect(rig.logs.some((text) => text.includes('(oversized)'))).toBe(true)
})

test('test_stderr_isLoggedWithoutItsContent', async () => {
  const rig = await live()
  at(rig.children, 0).write(`oops ${SECRET}\n`, 'stderr')
  await rig.step(0)
  expect(rig.logs).toHaveLength(1)
  expect(rig.logs.join('')).not.toContain(SECRET)
})

test('test_exit3_afterNeedsOrgKey_stopsWithItsSentenceAndNeverRestarts', async () => {
  const rig = await started()
  const child = at(rig.children, 0)
  child.write(HELLO + ERROR('needs_org_key'))
  child.end(3)
  await rig.step(0)
  expect(rig.status()).toEqual({ phase: 'stopped', reason: 'needs_org_key', sentence: 'Sentence for needs_org_key.' })
  await rig.step(600000)
  expect(rig.spawns).toHaveLength(1)
})

test('test_exit4_afterAuthRefused_stopsAndNeverRestarts', async () => {
  const rig = await started()
  const child = at(rig.children, 0)
  child.write(HELLO + ERROR('auth_refused'))
  child.end(4)
  await rig.step(0)
  expect(rig.status()).toMatchObject({ phase: 'stopped', reason: 'auth_refused' })
  await rig.step(600000)
  expect(rig.spawns).toHaveLength(1)
})

test('test_exit3_withoutAnErrorLine_stillStopsNamingTheCode', async () => {
  const rig = await started()
  at(rig.children, 0).write(HELLO)
  at(rig.children, 0).end(3)
  await rig.step(0)
  expect(rig.status()).toEqual({ phase: 'stopped', reason: 'no_identity', sentence: null })
})

for (const code of ['needs_org_key', 'no_identity', 'auth_refused', 'rate_limited', 'network', 'server', 'malformed_page']) {
  test(`test_pause_afterFeedErrorCode_${code}_reportsThatReason`, async () => {
    const rig = await live()
    at(rig.children, 0).write(ERROR(code))
    at(rig.children, 0).end(1)
    await rig.step(0)
    expect(rig.status()).toMatchObject({ phase: 'paused', reason: code })
  })
}

test('test_exit1_afterHello_pausesAndRestartsWithGrowingBackoff', async () => {
  const rig = await live()
  at(rig.children, 0).end(1)
  await rig.step(0)
  expect(rig.status().phase).toBe('paused')
  await rig.step(5600)
  expect(rig.spawns).toHaveLength(2)
  expect(rig.status().phase).toBe('starting')
  at(rig.children, 1).write(HELLO)
  at(rig.children, 1).end(1)
  await rig.step(0)
  await rig.step(5600)
  expect(rig.spawns).toHaveLength(2)
  await rig.step(5600)
  expect(rig.spawns).toHaveLength(3)
})

test('test_noHelloInTenSeconds_retriesOnceThenStopsAsCliTooOldAndKillsTheChild', async () => {
  const rig = await started()
  await rig.step(HELLO_TIMEOUT_MS - 100)
  expect(rig.status().phase).toBe('starting')
  await rig.step(200)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.spawns).toHaveLength(2)
  expect(rig.status().phase).toBe('starting')
  await rig.step(HELLO_TIMEOUT_MS + 100)
  expect(rig.status()).toEqual({ phase: 'stopped', reason: 'cli_too_old', sentence: null })
  expect(at(rig.children, 1).isReturned).toBe(true)
  await rig.step(600000)
  expect(rig.spawns).toHaveLength(2)
})

test('test_slowFirstStart_helloOnTheRetryChild_goesLive', async () => {
  const rig = await started()
  await rig.step(HELLO_TIMEOUT_MS + 100)
  at(rig.children, 1).write(HELLO)
  await rig.step(0)
  expect(rig.status().phase).toBe('live')
  await rig.step(HELLO_TIMEOUT_MS * 3)
  expect(rig.status().phase).toBe('live')
})

test('test_stopWhileHelloClockReadPending_staysIdle', async () => {
  const rig = await started()
  let release: (now: number) => void = () => {}
  rig.kit.ports.clock.now = () => new Promise<number>((resolve) => (release = resolve))
  at(rig.children, 0).write(HELLO)
  await rig.step(0)
  rig.feed.stop()
  release(1)
  await rig.step(0)
  expect(rig.status()).toEqual({ phase: 'idle', reason: null, sentence: null })
})

test('test_sinkThatThrows_isLoggedAndLaterFramesStillArrive', async () => {
  const rig = createRig(false, true)
  rig.feed.start()
  await rig.step(0)
  at(rig.children, 0).write(HELLO + ROW + ROW)
  await rig.step(0)
  expect(rig.frames).toHaveLength(2)
  expect(rig.status().phase).toBe('live')
  expect(rig.logs).toContain('rine: org feed sink threw')
})

test('test_exitBeforeHello_stopsAsCliTooOld', async () => {
  const rig = await started()
  at(rig.children, 0).write("error: unknown command 'tui'\n", 'stderr')
  at(rig.children, 0).end(1)
  await rig.step(0)
  expect(rig.status()).toMatchObject({ phase: 'stopped', reason: 'cli_too_old' })
  await rig.step(600000)
  expect(rig.spawns).toHaveLength(1)
})

test('test_spawnThatThrows_pausesAndRetriesInsteadOfCallingTheCliTooOld', async () => {
  const rig = await started(true)
  expect(rig.status()).toMatchObject({ phase: 'paused', reason: null })
  await rig.step(600000)
  expect(rig.spawns.length).toBeGreaterThan(1)
})

test('test_childKilledBeforeHello_pausesInsteadOfCallingTheCliTooOld', async () => {
  const rig = await started()
  at(rig.children, 0).end(null)
  await rig.step(0)
  expect(rig.status()).toMatchObject({ phase: 'paused', reason: null })
})

test('test_stop_killsTheFeedGoesIdleAndDropsLateFrames', async () => {
  const rig = await live()
  rig.feed.stop()
  await rig.step(0)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.status()).toEqual({ phase: 'idle', reason: null, sentence: null })
  at(rig.children, 0).write(ROW)
  await rig.step(600000)
  expect(rig.frames).toEqual([])
  expect(rig.spawns).toHaveLength(1)
})

test('test_stop_duringBackoff_cancelsTheRestart', async () => {
  const rig = await live()
  at(rig.children, 0).end(1)
  await rig.step(0)
  rig.feed.stop()
  await rig.step(600000)
  expect(rig.spawns).toHaveLength(1)
})

test('test_restartAfterStop_spawnsAgain', async () => {
  const rig = await live()
  rig.feed.stop()
  rig.feed.start()
  await rig.step(0)
  expect(rig.spawns).toHaveLength(2)
})

test('test_loadOlder_spawnsOnceWithTheCursorOneAtATime', async () => {
  const rig = await live()
  const first = rig.feed.loadOlder('cur-1')
  await rig.step(0)
  void rig.feed.loadOlder('cur-2')
  await rig.step(0)
  expect(rig.spawns).toHaveLength(2)
  expect(at(rig.spawns, 1).argv).toEqual(['rine', 'tui', '--feed', '--once', '--before', 'cur-1'])
  expect(at(rig.spawns, 1).env).toEqual({ RINE_CONFIG_DIR: '/cfg' })
  at(rig.children, 1).write(HELLO + ROW + line('page', { kind: 'older', count: 1, older_cursor: null }))
  at(rig.children, 1).end(0)
  await first
  expect(rig.frames.map((frame) => frame.kind)).toEqual(['row', 'page'])
  void rig.feed.loadOlder('cur-3')
  await rig.step(0)
  expect(rig.spawns).toHaveLength(3)
  expect(rig.status().phase).toBe('live')
})

test('test_stop_killsAnOlderPageChild', async () => {
  const rig = await live()
  void rig.feed.loadOlder('cur-1')
  await rig.step(0)
  rig.feed.stop()
  await rig.step(0)
  expect(at(rig.children, 1).isReturned).toBe(true)
})

test('test_loadOlder_whileStopped_spawnsNothing', async () => {
  const rig = createRig()
  await rig.feed.loadOlder('cur-1')
  expect(rig.spawns).toEqual([])
})
