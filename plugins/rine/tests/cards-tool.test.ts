import { expect, mock, test, type Engine } from 'claude-code/testing'
import { directoryRow, discoverOutput, inboxOutput, messageRow, readOutput, toolName } from './cards-kit'
import { NOW, seedUi, SURFACES } from './ui-kit'

const HOSTILE = 'bo\x1b[31mb‮@acme\u{E0041}.net'
const HOSTILE_MATCH = /\\u001b|\\u202e|‮|\u{E0041}/u

for (const surface of SURFACES) {
  const mount = ($: Engine, tool: string, output: unknown, over: Record<string, unknown> = {}) =>
    $.ui.mount({ plugin: 'rine', surface, component: 'ToolResult', requestId: String(over.tool_use_id ?? 'tu-1'),
      props: { tool_use_id: 'tu-1', tool, output, isErrored: false, ...over } as never })

  test(`test_card_inbox_drawsRowsAndRawButton_on_${surface}`, async ($, on) => {
    seedUi(on)
    const rows = [
      messageRow(),
      messageRow({ sender_handle: 'carol@acme.rine.network', type: 'rine.v1.task', group_handle: '#ops@acme.rine.network' })
    ]
    const ui = await mount($, toolName('rine_inbox'), inboxOutput(rows))
    expect(await ui.find({ type: 'Text', text: '● bob@acme.rine.network ✓ · dm · 2m · hpke-v1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● carol@acme.rine.network ✓ · task · #ops@acme.rine.network · 2m · hpke-v1' })).toBeDefined()
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.props.label).toBe('raw')
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    await ui.unmount()
  })

  test(`test_card_inboxOverTen_drawsTenRowsThenPlusN_on_${surface}`, async ($, on) => {
    seedUi(on)
    const rows = Array.from({ length: 12 }, () => messageRow())
    const ui = await mount($, toolName('rine_inbox'), inboxOutput(rows))
    expect(await ui.findAll({ type: 'Text', text: /^● / })).toHaveLength(10)
    expect(await ui.find({ type: 'Text', text: '+2 more' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_read_drawsHeaderAndBody_on_${surface}`, async ($, on) => {
    seedUi(on)
    const ui = await mount($, toolName('rine_read'), readOutput())
    expect(await ui.find({ type: 'Text', text: 'bob@acme.rine.network · verified ✓ · dm · hpke-v1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '│ Can you rebase the branch?' })).toBeDefined()
    await ui.unmount()
    const other = await mount($, toolName('rine_read'), readOutput({ verified: false }))
    expect(await other.find({ type: 'Text', text: /not verified ✗/ })).toBeDefined()
    await other.unmount()
  })

  test(`test_card_readLongBody_isCappedAt1200_on_${surface}`, async ($, on) => {
    seedUi(on)
    const ui = await mount($, toolName('rine_read'), readOutput({ decrypted: { text: 'a'.repeat(1500) } }))
    expect((await ui.find({ type: 'Text', text: /^│ a+$/ }))?.text?.length).toBe(1202)
    expect(await ui.find({ type: 'Text', text: '+300 chars not shown' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_discover_drawsHandleNameTier_on_${surface}`, async ($, on) => {
    seedUi(on)
    const rows = [directoryRow(), directoryRow({ handle: 'zed@acme.rine.network', name: 'Zed', trust_tier: 1 })]
    const ui = await mount($, toolName('rine_discover'), discoverOutput(rows))
    expect(await ui.find({ type: 'Text', text: 'ada@acme.rine.network · "Ada Review Bot" · tier 2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'zed@acme.rine.network · "Zed" · tier 1' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_rawPress_setsIsRawShownAndNextDrawFallsThrough_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on)
    const output = inboxOutput([messageRow()])
    const ui = await mount($, toolName('rine_inbox'), output)
    await ui.press({ key: 'raw' })
    expect(seeded.sets).toContainEqual(['isRawShown:tu-1', true])
    await ui.unmount()
    const next = await mount($, toolName('rine_inbox'), output)
    expect(await next.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await next.findAll({ type: 'Button' })).toEqual([])
    await next.unmount()
  })

  test(`test_card_rawPress_swapsTheOpenCardToTheEngineRow_on_${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', async () => ({ type: 'Text', children: ['engine'] }) as never)
    const ui = await mount($, toolName('rine_inbox'), inboxOutput([messageRow()]))
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    await ui.press({ key: 'raw' })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_rawPressOnOneCall_leavesAnotherCallsCardDrawn_on_${surface}`, async ($, on) => {
    seedUi(on)
    const output = inboxOutput([messageRow()])
    const first = await mount($, toolName('rine_inbox'), output)
    await first.press({ key: 'raw' })
    const second = await mount($, toolName('rine_inbox'), output, { tool_use_id: 'tu-2' })
    expect(await second.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    expect(await second.findAll({ type: 'Button' })).toHaveLength(1)
    await first.unmount()
    await second.unmount()
  })

  test(`test_card_isRawShownAlreadyTrue_fallsThrough_on_${surface}`, async ($, on) => {
    seedUi(on, { 'isRawShown:tu-1': true })
    const ui = await mount($, toolName('rine_inbox'), inboxOutput([messageRow()]))
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_errored_fallsThrough_on_${surface}`, async ($, on) => {
    seedUi(on)
    const ui = await mount($, toolName('rine_inbox'), inboxOutput([messageRow()]), { isErrored: true })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_card_unparsableOutput_fallsThrough_on_${surface}`, async ($, on) => {
    seedUi(on)
    const outputs = [
      { content: [{ type: 'text', text: 'Error: not json' }], isError: false },
      '[]',
      inboxOutput([])
    ]
    for (const output of outputs) {
      const ui = await mount($, toolName('rine_inbox'), output)
      expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`test_card_otherTools_fallThrough_on_${surface}`, async ($, on) => {
    seedUi(on)
    const output = inboxOutput([messageRow()])
    for (const tool of [toolName('rine_send'), 'mcp__other__rine_inbox', 'Bash']) {
      const ui = await mount($, tool, output)
      expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`test_card_hostileStrings_drawStripped_on_${surface}`, async ($, on) => {
    seedUi(on)
    const cases: [string, unknown, string][] = [
      [toolName('rine_inbox'), inboxOutput([messageRow({ sender_handle: HOSTILE })]), 'bob@acme.net'],
      [toolName('rine_read'), readOutput({ decrypted: { text: 'hi\x1b[31m‮ there' } }), 'hi there'],
      [toolName('rine_discover'), discoverOutput([directoryRow({ name: HOSTILE })]), 'bob@acme.net']
    ]
    for (const [tool, output, shown] of cases) {
      const ui = await mount($, tool, output)
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn).not.toMatch(HOSTILE_MATCH)
      expect(drawn).toContain(shown)
      await ui.unmount()
    }
  })
}
