import { expect, test, type Engine } from 'claude-code/testing'
import { PANE, seedUi, SURFACES } from './ui-kit'

const FILE = {
  allow: [{ kind: 'agent', handle: 'eve@acme', agentId: null }, { kind: 'group', handle: '#ops@acme', agentId: 'g-1' }],
  deny: []
}

for (const surface of SURFACES) {
  const mount = ($: Engine) => $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: 'rine-inbox', props: PANE as never })

  test(`test_pane_untrustedLists_showTheEntriesToConfirm_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [], isListsTrusted: false, lists: FILE })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'allow: eve@acme' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'allow: #ops@acme (g-1)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'deny: none' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_trustedLists_showNoListLines_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [], lists: FILE })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^allow: / })).toBeUndefined()
    await ui.unmount()
  })
}

test('test_pane_untrustedLongList_showsEveryEntryOnItsOwnLine', async ($, on) => {
  const allow = Array.from({ length: 12 }, (_, at) => ({ kind: 'agent', handle: `colleague${at}@acme.rine.network`, agentId: null }))
  seedUi(on, { entries: [], isListsTrusted: false, lists: { allow: [...allow, { kind: 'agent', handle: 'mal@evil', agentId: 'a-mal' }], deny: [] } })
  const ui = await $.ui.mount({ plugin: 'rine', surface: SURFACES[0], component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
  expect(await ui.find({ type: 'Text', text: 'allow: mal@evil (a-mal)' })).toBeDefined()
  await ui.unmount()
})
