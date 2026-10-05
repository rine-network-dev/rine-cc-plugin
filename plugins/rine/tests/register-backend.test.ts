import { test, expect, mock } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { backendFor } from '../hooks/register'
import { seedUi } from './ui-kit'
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
