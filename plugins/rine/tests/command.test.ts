import { expect, test, type Engine } from 'claude-code/testing'
import { isMutating, parseCommand, USAGE, type Command } from '../hooks/commands/rine'
import { seedUi } from './ui-kit'

const TABLE: readonly [string, Command][] = [
  ['', { kind: 'open' }],
  ['mute', { kind: 'mute', spec: '1h' }],
  ['mute 8h', { kind: 'mute', spec: '8h' }],
  ['MUTE Off-Hours', { kind: 'mute', spec: 'off-hours' }],
  ['mute forever', { kind: 'mute', spec: 'forever' }],
  ['mute soon', { kind: 'usage' }],
  ['unmute', { kind: 'unmute' }],
  ['preview on', { kind: 'preview', isOn: true }],
  ['preview off', { kind: 'preview', isOn: false }],
  ['preview', { kind: 'usage' }],
  ['allow add bob@acme', { kind: 'edit', name: 'allow', op: 'add', raw: 'bob@acme' }],
  ['deny remove #ops@acme', { kind: 'edit', name: 'deny', op: 'remove', raw: '#ops@acme' }],
  ['allow add', { kind: 'usage' }],
  ['allow add a@b c@d', { kind: 'usage' }],
  ['allow list', { kind: 'show', name: 'allow' }],
  ['deny list', { kind: 'show', name: 'deny' }],
  ['reconnect', { kind: 'reconnect' }],
  ['takeover', { kind: 'takeover' }],
  ['frobnicate', { kind: 'usage' }]
]

for (const [args, expected] of TABLE) {
  test(`test_parseCommand_${JSON.stringify(args)}_is_${expected.kind}`, () => {
    expect(parseCommand(args)).toEqual(expected)
  })
}

test('test_isMutating_onlyKeyboardOnlyKinds', () => {
  const mutating = TABLE.filter(([, command]) => isMutating(command)).map(([, command]) => command.kind)
  expect(new Set(mutating)).toEqual(new Set(['mute', 'unmute', 'preview', 'edit', 'takeover']))
})

const run = ($: Engine, args: string, origin?: unknown) =>
  $.command.run({ command: 'rine', args, origin, presentation: 'text' } as never)

for (const kind of ['bridge', 'plugin']) {
  test(`test_command_mutatingRow_fromOrigin_${kind}_isRefused`, async ($, on) => {
    seedUi(on)
    for (const args of ['mute', 'unmute', 'preview on', 'allow add bob@acme', 'takeover']) {
      const out = await run($, args, { kind })
      expect(JSON.stringify(out)).toContain(`/rine ${args.split(' ')[0]} is for the user to run at the keyboard.`)
    }
  })
}

test('test_command_usage_fromComposer_printsUsage', async ($, on) => {
  seedUi(on)
  expect(JSON.stringify(await run($, 'frobnicate', { kind: 'composer' }))).toContain(USAGE.slice(0, 40))
})

test('test_command_open_opensTheInboxPane', async ($, on) => {
  const seeded = seedUi(on)
  expect(JSON.stringify(await run($, '', { kind: 'bridge' }))).toContain('rine inbox opened.')
  expect(seeded.opens).toHaveLength(1)
  expect(seeded.opens[0]).toMatchObject({ id: 'rine-inbox' })
})

test('test_command_open_unplaced_quotesTheReason', async ($, on) => {
  const seeded = seedUi(on)
  seeded.isPlaced = false
  expect(JSON.stringify(await run($, '', { kind: 'composer' }))).toContain('the inbox pane did not open: terminal too narrow')
})

test('test_command_allowList_printsHandlesAndFlagsUntrustedLists', async ($, on) => {
  seedUi(on, { lists: { allow: [{ kind: 'agent', handle: 'bob@acme', agentId: null }], deny: [] }, isListsTrusted: false })
  const text = JSON.stringify(await run($, 'allow list', { kind: 'bridge' }))
  expect(text).toContain('allow list (1): bob@acme (changed outside /rine')
  expect(JSON.stringify(await run($, 'deny list', { kind: 'bridge' }))).toContain('deny list (0): empty')
})

test('test_command_badHandle_fromComposer_saysWhatAHandleLooksLike', async ($, on) => {
  seedUi(on)
  const out = JSON.stringify(await run($, 'allow add nonsense', { kind: 'composer' }))
  expect(out).toContain('nonsense is not a handle: use name@org or #group@org.')
})

test('test_command_listHandle_isScrubbed', async ($, on) => {
  seedUi(on, { lists: { allow: [{ kind: 'agent', handle: 'bo\u001b[31mb@acme', agentId: null }], deny: [] } })
  expect(JSON.stringify(await run($, 'allow list', { kind: 'composer' }))).not.toContain('\\u001b')
})
