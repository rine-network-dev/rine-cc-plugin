import { test, expect, mock } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { backendFor, orgDrawOf } from '../hooks/register'
import { seedUi, PANE } from './ui-kit'
import { tick } from './tick'

test('test_backend_messageCount_countsTheApiFormOfTheSession', async () => {
  const asked: unknown[] = []
  const $ = {
    session: {
      messages: async (options?: { as?: string }) => {
        asked.push(options)
        return options?.as === 'api' ? [1, 2, 3] : [1, 2, 3, 4, 5]
      }
    }
  } as unknown as EngineInterface
  expect(await backendFor($).messageCount()).toBe(3)
  expect(asked).toEqual([{ as: 'api' }])
})

test('test_compose_sessionStarted_addsTheRineContextSection', async ($, on) => {
  seedUi(on)
  mock.env(on, { RINE_CONFIG_DIR: '/tmp/rine-compose-test', HOME: '/tmp/rine-compose-home' })
  on('session.start', async () => ({ cwd: '/tmp/rine-compose-cwd' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }) as never)
  on('prompt.compose', async () => ({ sections: [] }) as never)
  on('ui.status', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/tmp/rine-compose-cwd', isInteractive: false } as never)
  let ids: string[] = []
  for (let i = 0; i < 200 && !ids.includes('rine:context'); i++) {
    await tick()
    ids = (await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections.map((section) => section.id)
  }
  expect(ids).toContain('rine:context')
})

test('test_orgDraw_status_isWhatThePaneDrawsAndBumpsTheRedrawCounter', async ($, on) => {
  const kept: Record<string, unknown> = {}
  const state = {
    get: async ({ key }: { key: string }) => ({ value: kept[key], version: 1 }),
    set: async ({ key }: { key: string }, value: unknown) => ((kept[key] = value), { isSet: true, version: 2 })
  }
  const ack = { phase: 'ack', reason: null, loaded: 0, gaps: 0 } as const
  const draw = orgDrawOf({ state } as unknown as EngineInterface)
  await draw(ack)
  await draw(ack)
  expect(kept.orgRev).toBe(2)
  seedUi(on, { orgTab: 'org', ...kept })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'desktop', component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
  expect((await ui.findAll({ type: 'Text' })).map((text) => text.text).join('\n')).toContain('Press w to show them')
  await ui.unmount()
})

/** `register.tsx` and `pane.tsx` each spell the status and redraw keys out, because the engine's module scan forbids sharing a ref between files. */
test('test_orgStateKeys_registerWritesWhatThePaneReadsAndWrites', async ($, on) => {
  const registerWrites = new Set<string>()
  const state = {
    get: async () => ({ value: undefined, version: 1 }),
    set: async ({ key }: { key: string }) => (registerWrites.add(key), { isSet: true, version: 2 })
  }
  const live = { phase: 'live', reason: null, loaded: 1, gaps: 0 } as const
  await orgDrawOf({ state } as unknown as EngineInterface)(live)
  expect(registerWrites.size).toBe(2)

  const seeded = seedUi(on, { orgStatus: live })
  const paneReads = new Set<string>()
  seeded.values = new Proxy(seeded.values, { get: (target, key) => (paneReads.add(String(key)), Reflect.get(target, key)) })
  const mount = () => $.ui.mount({ plugin: 'rine', surface: 'desktop', component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
  const inbox = await mount()
  await inbox.press({ plugin: 'rine', key: 'org' } as never)
  await inbox.unmount()
  Object.assign(seeded.values, { orgTab: 'org', orgStatus: live })
  const tab = await mount()
  await tab.post({ epoch: 'a', keys: [{ seq: 1, key: 'j' }] }, { key: 'org-keys' })
  await tab.unmount()
  const paneWrites = new Set(seeded.sets.map(([key]) => key))
  for (const key of registerWrites) {
    expect(paneReads.has(key), `the pane reads ${key}`).toBe(true)
    expect(paneWrites.has(key), `the pane writes ${key}`).toBe(true)
  }
})
