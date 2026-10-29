import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { createOrg, registerOrg, type OrgHost } from '../hooks/register-org'
import type { Host } from '../hooks/runtime/host'
import { applyOrgKeys } from '../hooks/ui/org-keys-input'
import { INBOX_PANE } from '../hooks/ui/pane-actions'
import type { RineOrgStatus } from '../types/index'
import { FEED_CONTRACT_LINES } from './feed-contract'
import { at } from './at'
import { tick } from './tick'
import { createChild, type FakeChild } from './stream-kit'

function createRig(isEnvFailing = false) {
  const children: FakeChild[] = []
  const logs: string[] = []
  const drawn: RineOrgStatus[] = []
  const org = createOrg()
  const host = {
    backend: { now: async () => 0, sleep: async () => undefined, exists: async () => false, log: (text: string) => logs.push(text) },
    env: async (name: string) => {
      if (isEnvFailing) throw new Error('env boom')
      return name === 'rineConfigDir' ? '/cfg' : undefined
    },
    cwd: async () => '/work',
    spawn: () => {
      const child = createChild()
      children.push(child)
      return child
    },
    after: () => () => undefined
  } as unknown as Host
  const made: OrgHost = { host, ack: { load: async () => undefined, save: async () => undefined }, draw: async (s) => drawn.push(s) }
  let binds = 0
  return {
    org,
    children,
    logs,
    drawn,
    binds: () => binds,
    bind: () => org.bind(() => (binds += 1, made)),
    settle: async () => {
      for (let i = 0; i < 4; i += 1) await tick()
    },
    feedLines: (child: FakeChild) => FEED_CONTRACT_LINES.forEach((line) => child.write(line + '\n'))
  }
}

/** A tab that read rows: the feed is up and the store holds them. */
async function reading() {
  const rig = createRig()
  rig.bind()
  rig.org.env.feed.start()
  await rig.settle()
  rig.feedLines(at(rig.children, 0))
  await rig.settle()
  expect(rig.org.env.store().order.length).toBeGreaterThan(0)
  return rig
}

test('test_start_afterBind_spawnsTheFeed', async () => {
  const rig = createRig()
  rig.bind()
  rig.org.env.feed.start()
  await rig.settle()
  expect(rig.children).toHaveLength(1)
})

test('test_start_beforeBind_beginsOnceBound', async () => {
  const rig = createRig()
  rig.org.env.feed.start()
  await rig.settle()
  expect(rig.children).toHaveLength(0)
  rig.bind()
  await rig.settle()
  expect(rig.children).toHaveLength(1)
})

test('test_bind_calledTwice_makesTheHostOnce', () => {
  const rig = createRig()
  rig.bind()
  rig.bind()
  expect(rig.binds()).toBe(1)
})

test('test_stop_beforeBind_doesNotBeginOnBind', async () => {
  const rig = createRig()
  rig.org.env.feed.start()
  rig.org.env.feed.stop()
  rig.bind()
  await rig.settle()
  expect(rig.children).toHaveLength(0)
})

test('test_end_clearOrResume_keepsTheFeed', async () => {
  const rig = await reading()
  rig.org.end('clear')
  rig.org.end('resume')
  expect(at(rig.children, 0).isReturned).toBe(false)
  expect(rig.org.env.store().order.length).toBeGreaterThan(0)
})

test('test_end_otherReason_stopsTheFeed', async () => {
  const rig = await reading()
  rig.org.end('logout')
  expect(at(rig.children, 0).isReturned).toBe(true)
})

test('test_feed_findingFrame_isKeptInMemoryWithItsGroupAndNeverDrawnIntoState', async () => {
  const rig = await reading()
  expect(rig.org.env.store().findings.map((found) => found.groupId)).toEqual(['g-7'])
  expect(rig.org.env.store().findings[0]?.sentence).toContain('sender key never reached')
  expect(JSON.stringify(rig.drawn)).not.toContain('sender key')
})

test('test_stop_afterRows_dropsTheRowsFromMemory', async () => {
  const rig = await reading()
  rig.org.env.feed.stop()
  expect(rig.org.env.store().order).toHaveLength(0)
  expect(rig.org.env.store().rows.size).toBe(0)
  expect(rig.org.env.store().findings).toHaveLength(0)
})

test('test_reread_stopThenStart_runsANewFeedOverAnEmptyStore', async () => {
  const rig = await reading()
  rig.org.env.feed.stop()
  rig.org.env.feed.start()
  await rig.settle()
  expect(rig.children).toHaveLength(2)
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.org.env.store().order).toHaveLength(0)
})

test('test_rereadKey_clearsTheHeldFindings_andTheNextReadRefillsThem', async () => {
  const rig = await reading()
  expect(rig.org.env.store().findings.map((found) => found.groupId)).toEqual(['g-7'])
  const host = { setTab: async () => undefined, setStatus: async () => undefined, redraw: async () => undefined, warn: () => undefined }
  await applyOrgKeys(rig.org.env, host, { epoch: 'e', keys: [{ seq: 1, key: 'R' }] })
  await rig.settle()
  expect(rig.children).toHaveLength(2)
  expect(rig.org.env.store().findings).toEqual([])
  rig.feedLines(at(rig.children, 1))
  await rig.settle()
  expect(rig.org.env.store().findings.map((found) => found.groupId)).toEqual(['g-7'])
})

test('test_uiClose_inboxPane_stopsTheFeed', async () => {
  const rig = await reading()
  const handlers = new Map<string, (...args: never[]) => Promise<unknown>>()
  const on = ((name: string, fn: (...args: never[]) => Promise<unknown>) => handlers.set(name, fn)) as unknown as On
  registerOrg(on, rig.org)
  const next = async (e: unknown) => ({ value: e })
  await handlers.get('ui.close')?.(...([null, { id: 'some-other-pane' }, next] as never[]))
  expect(at(rig.children, 0).isReturned).toBe(false)
  await handlers.get('ui.close')?.(...([null, { id: INBOX_PANE.id }, next] as never[]))
  expect(at(rig.children, 0).isReturned).toBe(true)
  expect(rig.org.env.store().order).toHaveLength(0)
})

test('test_start_whenBeginFails_showsAStoppedTabWithASentence', async () => {
  const rig = createRig(true)
  rig.bind()
  rig.org.env.feed.start()
  await rig.settle()
  expect(rig.logs).toContain('rine: org feed did not start')
  expect(at(rig.drawn, rig.drawn.length - 1).phase).toBe('stopped')
  expect(rig.org.env.sentence()).toContain('could not start')
})

test('test_ack_beforeBind_isNotReady', async () => {
  const rig = createRig()
  await expect(rig.org.env.ack.load('k')).rejects.toThrow('not ready')
  await expect(rig.org.env.ack.save('k', 1)).rejects.toThrow('not ready')
})
