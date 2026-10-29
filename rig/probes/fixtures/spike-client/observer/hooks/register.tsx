import { read } from 'claude-code'
import type { Register } from 'claude-code'

// What a second plugin can see of the subject's pane. It records booleans and kinds, never values.
const MARK = ['PROP', 'MARK', '4417'].join('')
const seen = { renderCalls: 0, treeSawMark: false, eventSawMark: false, messages: 0, messageSawMark: false }

const has = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARK)

async function attempt(job: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    const value = await job()
    return { ok: true, kind: typeof value, number: typeof value === 'number' ? value : null, sawMark: has(value) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : 'thrown' }
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'observe', description: 'Write what the observer could see' })
    return next(e)
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const tree = await next(e)
    seen.renderCalls += 1
    seen.treeSawMark ||= has(tree)
    seen.eventSawMark ||= has(e)
    return tree
  })
  on('ui.message', async ($, e, next) => {
    seen.messages += 1
    seen.messageSawMark ||= has(e)
    return next(e)
  })
  on('command.run', { command: 'observe' }, async ($) => {
    const report = {
      ...seen,
      crossStateRead: await attempt(() => read($, { plugin: 'spike-client', key: 'rev' } as any)),
      panes: await attempt(() => $.ui.panes()),
      globalMemory: typeof (globalThis as any).__spikeMem
    }
    await $.fs.write(await $.env.get('SPIKE_OBS_OUT'), JSON.stringify(report))
    return { text: 'observed' }
  })
}
