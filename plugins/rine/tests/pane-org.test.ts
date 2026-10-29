import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { ORG_ACK_KEY } from '../hooks/lib/org-ack'
import { FINDINGS_LIMIT, FINDINGS_TRIMMED, addOrgFinding } from '../hooks/lib/org-findings'
import { stillLook } from '../hooks/lib/motion'
import { addOrgRow, emptyOrgStore, type OrgStore } from '../hooks/lib/org-window'
import type { RineOrgStatus } from '../types/index'
import { ORG_STATUS_IDLE, nextOrgRev, openOrgTab, orgTab, type OrgTabEnv, type OrgTabHost } from '../hooks/ui/org-tab'
import { CONTRACT_ROWS, OLDER_CURSOR, fillOrgStore } from './org-kit'
import { at } from './at'
import { tick } from './tick'
import { PANE_PROPS, newWorld, type World } from './wiring-kit'
import { seedUi, PANE, SURFACES } from './ui-kit'

/** The plaintext of the contract's first message; the tests look for it everywhere it must not be. */
const SENTINEL = 'SENTINEL-plaintext-4821'
const REQUEST = 'org-tab-test'
const ACK: RineOrgStatus = { phase: 'ack', reason: null, loaded: 0, gaps: 0 }
const LIVE: RineOrgStatus = { phase: 'live', reason: null, loaded: 2, gaps: 1 }

type Rig = {
  world: World
  env: OrgTabEnv
  store: OrgStore
  /** The feed and the acknowledgement store, in call order. */
  calls: string[]
  kept: Map<string, unknown>
  sentence: { value: string | null }
  isSaveFailing: { value: boolean }
}

/** The host over the world's in-memory state: a test hook may not reach `$.state`, so the tab is driven without it. */
function hostOf(world: World): OrgTabHost {
  const set = async (key: string, value: unknown): Promise<void> => void world.state.set(key, value)
  return {
    setTab: (tab) => set('orgTab', tab),
    setStatus: (status) => set('orgStatus', status),
    redraw: () => set('orgRev', nextOrgRev(world.state.get('orgRev') as number | undefined)),
    warn: (text) => void world.toasts.push(text)
  }
}

/** The org tab drawn through a render handler of its own, beneath the plugin, over a fake feed and a fake acknowledgement store. */
function rig(on: On, state: Record<string, unknown> = {}, kept: [string, unknown][] = []): Rig {
  const world = newWorld(on, { state })
  const store = emptyOrgStore()
  const calls: string[] = []
  const memory = new Map<string, unknown>(kept)
  const sentence = { value: null as string | null }
  const isSaveFailing = { value: false }
  const env: OrgTabEnv = {
    store: () => store,
    sentence: () => sentence.value,
    ack: {
      load: async (key) => memory.get(key),
      save: async (key, value) => {
        calls.push(`save ${key}`)
        await tick()
        if (isSaveFailing.value) throw new Error('read-only')
        memory.set(key, value)
        calls.push('saved')
      }
    },
    feed: {
      start: () => void calls.push('start'),
      stop: () => void calls.push('stop'),
      loadOlder: async (cursor) => void calls.push(`older ${cursor}`)
    }
  }
  on('ui.render', { component: 'Pane', requestId: REQUEST }, async ($, e) => {
    const status = (world.state.get('orgStatus') as RineOrgStatus | undefined) ?? ORG_STATUS_IDLE
    const look = { ...stillLook(Date.now()), isFocused: e.props.isFocused === true }
    return orgTab($.ui.resolve(e), e.props.bodyColumns, status, env, hostOf(world), null, look) as never
  })
  return { world, env, store, calls, kept: memory, sentence, isSaveFailing }
}

const mount = ($: Engine, surface: (typeof SURFACES)[number], props: object = PANE_PROPS) =>
  $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: REQUEST, props: props as never })

type Mounted = Awaited<ReturnType<typeof mount>>
/** The org tab's own render handler belongs to the test plugin, so its Buttons are pressed under that name. */
const press = (ui: Mounted, key: string) => ui.press({ plugin: 'test', key } as never)
const textsOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t) => t.text)
const labelsOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).map((b) => String(b.props.label))

for (const surface of SURFACES) {
  test(`test_orgTab_firstOpen_showsTheAcknowledgementAndStartsNoFeed_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: ACK })
    const ui = await mount($, surface)
    expect((await textsOf(ui)).join(' ')).toContain('every agent in your org')
    expect((await textsOf(ui)).join(' ')).toContain('any other plugin installed in Claude Code')
    expect((await textsOf(ui)).join(' ')).toContain('You see this once on this machine.')
    expect(await labelsOf(ui)).toEqual(['Show', 'Inbox'])
    expect(r.calls).toEqual([])
    await ui.unmount()
  })

  test(`test_orgTab_showPressed_savesTheAcknowledgementThenStartsTheFeed_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: ACK })
    const ui = await mount($, surface)
    await press(ui, 'show')
    expect(r.calls).toEqual([`save ${ORG_ACK_KEY}`, 'saved', 'start'])
    expect(r.kept.get(ORG_ACK_KEY)).toEqual({ v: 1 })
    await ui.unmount()
  })

  test(`test_orgTab_saveFails_keepsTheFeedClosedAndSaysSo_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: ACK })
    r.isSaveFailing.value = true
    const ui = await mount($, surface)
    await press(ui, 'show')
    expect(r.calls).toEqual([`save ${ORG_ACK_KEY}`])
    expect(r.world.toasts).toEqual(['rine: could not save your acknowledgement, so the org view stays closed'])
    await ui.unmount()
  })

  test(`test_orgTab_inboxPressedOnTheAcknowledgement_storesNothingAndReturnsToTheInbox_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: ACK })
    const ui = await mount($, surface)
    await press(ui, 'inbox')
    expect(r.calls).toEqual(['stop'])
    expect(r.kept.size).toBe(0)
    expect(r.world.state.get('orgTab')).toBe('inbox')
    await ui.unmount()
  })

  test(`test_orgTab_buttons_areSingleLowercaseLettersAndAvoidTheBandsKeys_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => [b.props.label, b.props.hotkey])).toEqual([
      ['Next', 'j'], ['Previous', 'k'], ['Top', 't'], ['Bottom', 'b'], ['View', 'v'], ['Older', 'p'], ['Re-read', 'r'], ['Inbox', 'i']
    ])
    for (const key of ['o', 'h', 'm', 'u']) expect(buttons.map((b) => b.props.hotkey)).not.toContain(key)
    await ui.unmount()
  })

  test(`test_orgTab_rows_drawFromModuleMemoryAndTheKeysMoveTheSelection_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    expect((await textsOf(ui)).join('\n')).toContain(SENTINEL.slice(0, 10))
    expect(r.store.view.selectedId).toBeNull()
    await press(ui, 'next')
    expect(r.store.view.selectedId).toBe(at(r.store.order, 0))
    await press(ui, 'bottom')
    expect(r.store.view.selectedId).toBe(at(r.store.order, 1))
    await press(ui, 'previous')
    expect(r.store.view.selectedId).toBe(at(r.store.order, 0))
    await press(ui, 'next')
    await press(ui, 'top')
    expect(r.store.view.selectedId).toBe(at(r.store.order, 0))
    expect(r.world.state.get('orgRev')).toBe(5)
    await ui.unmount()
  })

  test(`test_orgTab_bottomOnTheLastRow_loadsOlderMessagesLikeTheGKey_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    await press(ui, 'bottom')
    expect(r.calls).toEqual([])
    await press(ui, 'bottom')
    expect(r.calls).toEqual([`older ${OLDER_CURSOR}`])
    await ui.unmount()
  })

  test(`test_orgTab_view_opensTheReaderBehindAGutterAndClosesIt_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    r.store.view.selectedId = 'm1'
    let ui = await mount($, surface)
    await press(ui, 'view')
    expect(r.store.view.isReaderOpen).toBe(true)
    await ui.unmount()
    ui = await mount($, surface)
    expect((await ui.find({ key: 'line-0' }))?.text).toBe(`┃ ${SENTINEL}`)
    expect(await labelsOf(ui)).toContain('Close')
    await press(ui, 'view')
    expect(r.store.view.isReaderOpen).toBe(false)
    await ui.unmount()
  })

  test(`test_orgTab_header_namesTheOrgAndShowsTheLiveCounts_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    const header = (await ui.find({ key: 'head' }))?.text
    expect(header).toContain('◆ whole org')
    expect(header).toContain('live · 2 loaded · 1 gaps')
    // The row stops one cell short of the right edge, where Claude Code draws its close mark.
    expect(Array.from(header ?? '')).toHaveLength(PANE_PROPS.bodyColumns - 1)
    await ui.unmount()
  })

  test(`test_orgTab_rows_areOnePerMessageWithNoRawIdsOrWireNames_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    const rows = await ui.findAll({ type: 'Box' })
    const listed = rows.filter((box) => String(box.props.key ?? '').startsWith('org:'))
    expect(listed).toHaveLength(r.store.order.length)
    for (const row of listed) expect(row.text).not.toContain('rine.v1.')
    await ui.unmount()
  })

  test(`test_orgTab_reader_headsWithPartiesAndDimIdsAndAStamp_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    r.store.view.selectedId = 'm1'
    r.store.view.isReaderOpen = true
    const ui = await mount($, surface)
    const head = await ui.find({ key: 'reader-head' })
    expect(head?.text).toMatch(/[0-9a-f]{8}/)
    expect(head?.text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect((await ui.find({ key: 'reader-verdict' }))?.text).toBeTruthy()
    await ui.unmount()
  })

  for (const columns of [70, 80]) {
    test(`test_orgTab_reader_longRemoteGroupAndSender_keepBothAts_at_${columns}_on_${surface}`, async ($, on) => {
      const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
      const [first] = CONTRACT_ROWS
      if (first === undefined) throw new Error('no contract row')
      addOrgRow(r.store, {
        ...first,
        message: { ...first.message, id: 'long-1', to: null },
        display: { ...first.display, fromLabel: 'mx-cli@mx-cli-874177', groupLabel: '#mx-orgread-closed-123456@mx-ts-sdk-874177' }
      })
      r.store.view.selectedId = 'long-1'
      r.store.view.isReaderOpen = true
      const ui = await mount($, surface, { ...PANE_PROPS, bodyColumns: columns })
      const head = (await ui.find({ key: 'reader-head' }))?.text ?? ''
      expect(head.match(/@/g)).toHaveLength(2)
      await ui.unmount()
    })
  }

  test(`test_orgTab_reader_longBodyIsCutWithAMoreLinesNote_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    const [first] = CONTRACT_ROWS
    if (first === undefined) throw new Error('the contract has no rows')
    addOrgRow(r.store, { ...first, display: { ...first.display, body: Array.from({ length: 30 }, (_, n) => `line ${n}`).join('\n') } })
    r.store.view.selectedId = first.message.id
    r.store.view.isReaderOpen = true
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'more' }))?.text).toBe('+6 more lines')
    await ui.unmount()
  })

  test(`test_orgTab_hintRow_isDrawnOnlyWhileTheKeysAreArmed_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const armed = await mount($, surface)
    expect((await armed.find({ key: 'hints' }))?.text).toBe('j/k move · v view · r re-read · i inbox')
    await armed.unmount()
    const idle = await mount($, surface, { ...PANE_PROPS, isFocused: false })
    expect(await idle.find({ key: 'hints' })).toBeUndefined()
    await idle.unmount()
  })

  test(`test_orgTab_hintRow_saysCloseWhileTheReaderIsOpen_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    r.store.view.selectedId = 'm1'
    r.store.view.isReaderOpen = true
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'hints' }))?.text).toContain('v close')
    await ui.unmount()
  })

  test(`test_orgTab_noFindings_drawsNeitherTheBarNorTheButton_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    expect((await textsOf(ui)).join('\n')).not.toContain('finding')
    expect(await labelsOf(ui)).not.toContain('Findings')
    await ui.unmount()
  })

  test(`test_orgTab_findings_showTheBarAndTheButtonListsThemInTheDetailPanel_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    addOrgFinding(r.store, { kind: 'finding', groupId: 'c0ffee00-0000-4000-8000-000000000001', gapKey: 'NoEscrow', sentence: 'No key copy.' })
    addOrgFinding(r.store, { kind: 'finding', groupId: 'deadbeef-0000-4000-8000-000000000002', gapKey: 'NoDistribution', sentence: 'Key never reached.' })
    let ui = await mount($, surface)
    expect(await textsOf(ui)).toContain('2 findings · f lists them · In deadbeef: Key never reached.')
    expect(await labelsOf(ui)).toContain('Findings')
    await press(ui, 'findings')
    expect(r.store.vi.isFindingsOpen).toBe(true)
    await ui.unmount()
    ui = await mount($, surface)
    const texts = await textsOf(ui)
    expect(texts).toContain('In deadbeef: Key never reached.')
    expect(texts).toContain('In c0ffee00: No key copy.')
    await press(ui, 'findings')
    expect(r.store.vi.isFindingsOpen).toBe(false)
    await ui.unmount()
  })

  test(`test_orgTab_findingsList_saysOlderOnesWereDroppedOnlyAtTheLimit_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    addOrgFinding(r.store, { kind: 'finding', groupId: 'g-1', gapKey: 'k-0', sentence: 'First.' })
    r.store.vi.isFindingsOpen = true
    let ui = await mount($, surface)
    expect(await textsOf(ui)).not.toContain(FINDINGS_TRIMMED)
    await ui.unmount()
    for (let at = 1; at < FINDINGS_LIMIT; at += 1) addOrgFinding(r.store, { kind: 'finding', groupId: 'g-1', gapKey: `k-${at}`, sentence: `Finding ${at}.` })
    ui = await mount($, surface)
    expect(await textsOf(ui)).toContain(FINDINGS_TRIMMED)
    await ui.unmount()
  })

  test(`test_orgTab_findings_neverReachStateOrTheStatusSink_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    addOrgFinding(r.store, { kind: 'finding', groupId: 'g-1', gapKey: 'NoEscrow', sentence: 'SENTINEL-finding-7731' })
    const ui = await mount($, surface)
    await press(ui, 'findings')
    expect(JSON.stringify([...r.world.state.entries()])).not.toContain('SENTINEL-finding-7731')
    await ui.unmount()
  })

  test(`test_orgTab_olderAndReread_goToTheFeed_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    await press(ui, 'older')
    await press(ui, 'reread')
    expect(r.calls).toEqual([`older ${OLDER_CURSOR}`, 'stop', 'start'])
    await ui.unmount()
  })

  test(`test_orgTab_inboxPressed_stopsTheFeedAndSwitchesTab_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    fillOrgStore(r.store)
    const ui = await mount($, surface)
    await press(ui, 'inbox')
    expect(r.calls).toEqual(['stop'])
    expect(r.world.state.get('orgTab')).toBe('inbox')
    await ui.unmount()
  })

  for (const [name, status, sentence, shown] of [
    ['needsOrgKey', { phase: 'stopped', reason: 'needs_org_key' }, 'This view needs the org key.', 'This view needs the org key.'],
    ['noIdentity', { phase: 'stopped', reason: 'no_identity' }, 'No key for an org on this machine.', 'No key for an org on this machine.'],
    ['oldCli', { phase: 'stopped', reason: 'cli_too_old' }, null, 'This tab needs rine CLI 0.22.0 or later.'],
    ['paused', { phase: 'paused', reason: 'rate_limited' }, "Paused for 30 s: your org's read limit was reached.", "Paused for 30 s: your org's read limit was reached."]
  ] as const) {
    test(`test_orgTab_${name}_saysWhyInPlainWords_on_${surface}`, async ($, on) => {
      const r = rig(on, { orgTab: 'org', orgStatus: { ...status, loaded: 0, gaps: 0 } })
      r.sentence.value = sentence
      const ui = await mount($, surface)
      expect(await textsOf(ui)).toContain(shown)
      await ui.unmount()
    })
  }

  test(`test_orgTab_emptyAndLoadingStates_useTheirOwnSentences_on_${surface}`, async ($, on) => {
    const r = rig(on, { orgTab: 'org', orgStatus: LIVE })
    const states = [
      [{ ...LIVE, loaded: 0 }, 'No messages yet. New messages appear here as your agents send and receive them.'],
      [{ phase: 'starting', reason: null, loaded: 0, gaps: 0 }, "Reading your org's messages…"]
    ] as const
    for (const [status, shown] of states) {
      r.world.state.set('orgStatus', status)
      const ui = await mount($, surface)
      expect((await ui.find({ type: 'Box', key: 'reading' }))?.text ?? (await textsOf(ui)).join(' ')).toContain(shown)
      await ui.unmount()
    }
  })

  test(`test_pane_tabSwitch_showsTheInboxWithAWholeOrgButtonThenTheOrgTab_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on)
    const inbox = await $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
    const whole = (await inbox.findAll({ type: 'Button' })).find((b) => b.props.hotkey === 'w')
    expect(whole?.props.label).toBe('Whole org')
    await inbox.unmount()
    seeded.values.orgTab = 'org'
    seeded.values.orgStatus = ACK
    const tab = await $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
    expect((await tab.findAll({ type: 'Button' })).map((b) => b.props.label)).toEqual(['Show', 'Inbox'])
    await tab.unmount()
  })
}

test('test_openOrgTab_noStoredAcknowledgement_showsItAndStartsNoFeed', async ($, on) => {
  const r = rig(on)
  await openOrgTab(r.env, hostOf(r.world))
  expect(r.world.state.get('orgStatus')).toMatchObject({ phase: 'ack' })
  expect(r.world.state.get('orgTab')).toBe('org')
  expect(r.calls).toEqual([])
})

test('test_openOrgTab_storedAcknowledgement_opensStraightToTheFeed', async ($, on) => {
  const r = rig(on, {}, [[ORG_ACK_KEY, { v: 1 }]])
  await openOrgTab(r.env, hostOf(r.world))
  expect(r.world.state.get('orgTab')).toBe('org')
  expect(r.world.state.get('orgStatus')).toBeUndefined()
  expect(r.calls).toEqual(['start'])
})

test('test_openOrgTab_malformedStoredValueOrFailingStore_asksAgain', async ($, on) => {
  const r = rig(on, {}, [[ORG_ACK_KEY, { v: 2 }]])
  await openOrgTab(r.env, hostOf(r.world))
  expect(r.world.state.get('orgStatus')).toMatchObject({ phase: 'ack' })
  const broken = rig(on)
  broken.env.ack.load = () => Promise.reject(new Error('locked'))
  await openOrgTab(broken.env, hostOf(broken.world))
  expect(broken.world.state.get('orgStatus')).toMatchObject({ phase: 'ack' })
  expect(broken.calls).toEqual([])
})

test('test_orgTab_wholeSession_neverPutsTheAcknowledgementOrPlaintextInStateOrAnySink', async ($, on) => {
  const r = rig(on)
  fillOrgStore(r.store)
  await openOrgTab(r.env, hostOf(r.world))
  r.world.state.set('orgStatus', ACK)
  const ui = await mount($, 'terminal')
  await press(ui, 'show')
  expect(JSON.stringify([...r.world.state])).not.toContain(ORG_ACK_KEY)
  await ui.unmount()
  r.world.state.set('orgStatus', LIVE)
  const live = await mount($, 'terminal')
  for (const key of ['next', 'view', 'older', 'reread', 'inbox']) await press(live, key)
  await live.unmount()
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  const sinks = { state: [...r.world.state], toasts: r.world.toasts, statuses: r.world.statuses, logs: r.world.logs, submits: r.world.submits, composed }
  expect(JSON.stringify(sinks)).not.toContain(SENTINEL)
  expect(JSON.stringify([...r.world.state])).not.toContain(ORG_ACK_KEY)
})

/** A post from the keys module is drawn while the org tab is live; the state then moves on before the post lands. */
for (const [name, after, isHandled] of [
  ['acknowledgementPhase', { orgStatus: ACK }, false],
  ['inboxTab', { orgTab: 'inbox' }, false],
  ['liveOrgTab', {}, true]
] as const) {
  test(`test_orgKeysPost_${name}_${isHandled ? 'redraws' : 'isDropped'}`, async ($, on) => {
    const seeded = seedUi(on, { orgTab: 'org', orgStatus: LIVE })
    const ui = await $.ui.mount({ plugin: 'rine', surface: 'desktop', component: 'Pane', requestId: 'rine-inbox', props: PANE as never })
    Object.assign(seeded.values, after)
    await ui.post({ epoch: 'a', keys: [{ seq: 1, key: 'j' }] }, { key: 'org-keys' })
    expect(seeded.sets.some(([key]) => key === 'orgRev')).toBe(isHandled)
    await ui.unmount()
  })
}
