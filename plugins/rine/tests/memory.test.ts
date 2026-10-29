import { test, expect } from 'claude-code/testing'
import { createMemory, initialMem } from '../hooks/runtime/memory'

test('initialMem holds no org store: message rows stay in the org tab closure', () => {
  expect(Object.keys(initialMem())).not.toContain('org')
})

test('memory set publishes only shared keys', async () => {
  const published: Record<string, unknown>[] = []
  const memory = createMemory(initialMem(), async (patch) => { published.push(patch) }, () => {})
  memory.set({ isBusy: true, isDetecting: true })
  await Promise.resolve()
  await Promise.resolve()
  expect(published).toEqual([{ isBusy: true }])
})
