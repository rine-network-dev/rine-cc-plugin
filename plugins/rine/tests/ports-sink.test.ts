import { test, expect } from 'claude-code/testing'
import { portsFrom, type Backend } from '../hooks/lib/ports'
import { createKit } from './kit'

type BackendCalls = {
  appended: { type: 'user' | 'system'; text: string }[]
  logs: string[]
  toasts: string[]
  reads: string[]
}

function makeBackend(): { backend: Backend; calls: BackendCalls } {
  const calls: BackendCalls = { appended: [], logs: [], toasts: [], reads: [] }
  const backend: Backend = {
    now: async () => 0,
    sleep: async () => {},
    exists: async () => false,
    readText: async (path) => {
      calls.reads.push(path)
      return ''
    },
    writeText: async () => {},
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    append: async (type, text) => {
      calls.appended.push({ type, text })
      return { isDenied: false }
    },
    messageCount: async () => 0,
    submit: async (text: string) => ({ entered: text }),
    toast: (text) => {
      calls.toasts.push(text)
    },
    log: (text) => {
      calls.logs.push(text)
    }
  }
  return { backend, calls }
}

test('test_portsFrom_fsRead_missingFile_resolvesUndefined', async () => {
  const { backend, calls } = makeBackend()
  expect(await portsFrom(backend).fs.read('/missing')).toBeUndefined()
  expect(calls.reads).toHaveLength(0)
})

test('test_portsFrom_fsRead_existing_returnsText', async () => {
  const { backend } = makeBackend()
  backend.exists = async () => true
  backend.readText = async () => 'hello'
  expect(await portsFrom(backend).fs.read('/note')).toBe('hello')
})

test('test_portsFrom_sinkAppend_success_resolvesMessageCount', async () => {
  const { backend, calls } = makeBackend()
  backend.messageCount = async () => 7
  expect(await portsFrom(backend).sink.append('hi')).toBe(7)
  expect(calls.appended).toEqual([{ type: 'user', text: 'hi' }])
})

test('test_portsFrom_sinkAppend_denied_resolvesNull', async () => {
  const { backend } = makeBackend()
  let counted = 0
  backend.append = async () => ({ isDenied: true })
  backend.messageCount = async () => {
    counted += 1
    return 0
  }
  expect(await portsFrom(backend).sink.append('hi')).toBeNull()
  expect(counted).toBe(0)
})

test('test_portsFrom_sinkAppend_rejects_resolvesNullAndLogs', async () => {
  const { backend, calls } = makeBackend()
  backend.append = async () => {
    throw new Error('nope')
  }
  expect(await portsFrom(backend).sink.append('hi')).toBeNull()
  expect(calls.logs[0]).toContain('append failed')
})

test('test_portsFrom_sinkNotice_usesSystemRowAndSwallowsRejection', async () => {
  const { backend, calls } = makeBackend()
  backend.append = async (type, text) => {
    calls.appended.push({ type, text })
    throw new Error('nope')
  }
  await portsFrom(backend).sink.notice('note')
  expect(calls.appended).toEqual([{ type: 'system', text: 'note' }])
})

test('test_portsFrom_sinkSubmit_accepted_isNotDropped', async () => {
  const { backend } = makeBackend()
  expect(await portsFrom(backend).sink.submit('go')).toEqual({ isDropped: false, entered: 'go' })
})

test('test_portsFrom_sinkSubmit_dropReason_isDropped', async () => {
  const { backend } = makeBackend()
  backend.submit = async () => ({ drop: 'busy' })
  expect(await portsFrom(backend).sink.submit('go')).toEqual({ isDropped: true, reason: 'busy' })
})

test('test_portsFrom_sinkSubmit_rejects_isDroppedError', async () => {
  const { backend } = makeBackend()
  backend.submit = async () => {
    throw new Error('nope')
  }
  expect(await portsFrom(backend).sink.submit('go')).toEqual({ isDropped: true, reason: 'error' })
})

test('test_portsFrom_sinkToast_forwardsText', async () => {
  const { backend, calls } = makeBackend()
  portsFrom(backend).sink.toast('hello')
  expect(calls.toasts).toEqual(['hello'])
})

test('test_portsFrom_run_isRateLimited', async () => {
  const kit = createKit()
  const starts: number[] = []
  const { backend } = makeBackend()
  backend.now = kit.clock.now
  backend.sleep = kit.clock.sleep
  backend.run = async () => {
    starts.push(await kit.clock.now())
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const ports = portsFrom(backend)
  const t = await kit.clock.now()
  await Promise.all([
    ports.run(['a']),
    ports.run(['b']),
    ports.run(['c']),
    ports.run(['d']),
    ports.run(['e']),
    ports.run(['f'])
  ])
  await kit.clock.settle(ports.run(['g']))
  expect(starts[6]).toBeGreaterThanOrEqual(t + 60000)
})
