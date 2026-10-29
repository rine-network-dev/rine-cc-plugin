import { expect, test, type Engine } from 'claude-code/testing'
import { BAND, entry, seedUi, SURFACES } from './ui-kit'

const TWO = [
  entry({ id: 'a', from: 'bob@acme', type: 'rine.v1.task' }),
  entry({ id: 'b', from: 'carol@acme', group: '#ops@acme', type: 'rine.v1.reply' })
]
const HELD = ['a', 'b', 'c', 'd'].map((id) => entry({ id, from: 'bob@acme', disposition: 'held' }))

for (const surface of SURFACES) {
  const mount = ($: Engine, props: Record<string, unknown> = BAND) =>
    $.ui.mount({ plugin: 'rine', surface, component: 'AbovePrompt', props: props as never })

  test(`test_band_unread_drawsHeadlineHintAndLetterButtons_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: TWO })
    const ui = await mount($)
    const head = await ui.find({ key: 'head' })
    expect(head?.text).toContain('◆ rine  2 new — bob@acme (task), #ops@acme (reply) ctrl+x tab')
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.label)).toEqual(['Open', 'Hand to Claude (2)', 'Mark read', 'Mute 1h', 'Later'])
    expect(buttons.map((b) => b.props.hotkey)).toEqual(['o', 'h', 'm', 'u', 'l'])
    expect(buttons.at(-1)?.props.role).toBe('dismiss')
    expect(buttons.every((b) => /^[a-z]$/.test(String(b.props.hotkey)))).toBe(true)
    await ui.unmount()
  })

  test(`test_band_remoteSenderPastTheNameCells_keepsItsDomain_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [entry({ id: 'a', from: `${'s'.repeat(40)}@fjord21735`, type: 'rine.v1.task' })] })
    const ui = await mount($)
    expect((await ui.find({ key: 'head' }))?.text).toContain(`${'s'.repeat(20)}…@fjord21735 (task)`)
    await ui.unmount()
  })

  for (const columns of [80, 100]) {
    test(`test_band_longRemoteSenders_areWholeOrCountedAt_${columns}_on_${surface}`, async ($, on) => {
      const from = (n: number): string => `mx-cli-sender-${n}@mx-ts-sdk-874177.rine.network`
      seedUi(on, { entries: [1, 2, 3].map((n) => entry({ id: `s${n}`, from: from(n), type: 'rine.v1.task' })) })
      const ui = await mount($, { ...BAND, bodyColumns: columns })
      const head = (await ui.find({ key: 'head' }))?.text ?? ''
      const names = head.slice(head.indexOf('— ') + 2).replace(' ctrl+x tab', '').split(/, (?=mx-|\+)/)
      for (const name of names) expect(name.startsWith('+') || name.includes('@')).toBe(true)
      expect(head).toContain('ctrl+x tab')
      await ui.unmount()
    })
  }

  test(`test_band_previewName_atNarrowColumns_keepsItsAt_on_${surface}`, async ($, on) => {
    seedUi(on, {
      entries: [entry({ id: 'p1', from: 'procurement-team-europe@mx-ts-sdk-874177.rine.network' })],
      prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: true, isMotion: false }
    })
    const ui = await mount($, { ...BAND, bodyColumns: 30 })
    const previews = await ui.findAll({ type: 'Text' })
    expect(previews.some((t) => t.text.includes('@'))).toBe(true)
    await ui.unmount()
  })

  test(`test_band_fourNames_listsThreeAndPlusOne_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: HELD.map((one) => ({ ...one, disposition: 'notified' })) })
    const ui = await mount($)
    expect((await ui.find({ key: 'head' }))?.text).toContain('(dm), +1')
    await ui.unmount()
  })

  for (const [name, over, props] of [
    ['nothingUnread', { entries: [entry({ state: 'read' })] }, BAND],
    ['onlyFiltered', { entries: [entry({ list: 'deny' })] }, BAND],
    ['muted', { entries: TWO, prefs: { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false, isMotion: false } }, BAND],
    ['legacyPaused', { entries: TWO, isLegacyPaused: true }, BAND],
    ['survey', { entries: TWO }, { ...BAND, hasSurvey: true }]
  ] as const) {
    test(`test_band_${name}_defersToTheEngine_on_${surface}`, async ($, on) => {
      seedUi(on, over)
      const ui = await mount($, props)
      expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
      expect(await ui.findAll({ type: 'Button' })).toEqual([])
      await ui.unmount()
    })
  }

  test(`test_band_previewMode_reviewReplacesOpenNoHandAndPreviewRows_on_${surface}`, async ($, on) => {
    seedUi(on, {
      entries: HELD,
      prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: true },
      'preview:a': { status: 'ok', isVerified: true }
    })
    const ui = await mount($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.label)).toEqual(['Review', 'Mark read', 'Mute 1h', 'Later'])
    expect(await ui.findAll({ type: 'Text', text: 'bob@acme: decrypting…' })).toHaveLength(3)
    await ui.unmount()
  })

  test(`test_band_fewRows_dropPreviewRowsBeforeAnyButton_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: HELD, prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: true } })
    const tight = await mount($, { ...BAND, maxRows: 2 })
    expect(await tight.findAll({ type: 'Button' })).toHaveLength(4)
    expect(await tight.findAll({ type: 'Text', text: 'decrypting…' })).toEqual([])
    expect(await tight.find({ key: 'head' })).toBeDefined()
    await tight.unmount()
    const one = await mount($, { ...BAND, maxRows: 1 })
    expect(await one.findAll({ type: 'Button' })).toHaveLength(4)
    expect(await one.find({ key: 'head' })).toBeUndefined()
    expect((await one.find({ key: 'inline' }))?.text).toContain('◆ rine  4 new')
    await one.unmount()
  })

  test(`test_band_hostileHandle_drawsStripped_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [entry({ from: 'bo\x1b[31mb‮@acme\u{E0041}.net', type: 'rine.v1.dm' })] })
    const ui = await mount($)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).not.toMatch(/\\u001b|\\u202e|‮|\u{E0041}/u)
    expect(drawn).toContain('bob@acme.net')
    await ui.unmount()
  })

  test(`test_band_openPress_asksForFocusedPane_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: TWO })
    const ui = await mount($)
    await ui.press({ key: 'open' })
    expect(seeded.opens).toEqual([{ id: 'rine-inbox', title: 'rine', focus: true }])
    expect(seeded.toasts).toEqual([])
    seeded.isPlaced = false
    await ui.press({ key: 'open' })
    expect(seeded.toasts).toEqual(['rine: the inbox pane did not open: terminal too narrow'])
    await ui.unmount()
  })

  test(`test_band_later_foldsEveryListedEntryAndDrawsNothingMore_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: TWO })
    const ui = await mount($)
    await ui.press({ key: 'later' })
    expect(seeded.sets).toContainEqual(['foldedIds', ['a', 'b']])
    await ui.unmount()
    const again = await mount($)
    expect(await again.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await again.findAll({ type: 'Button' })).toEqual([])
    await again.unmount()
  })

  test(`test_band_actionPress_foldsBeforeItActs_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: TWO })
    const ui = await mount($)
    await ui.press({ key: 'open' })
    expect(seeded.sets).toContainEqual(['foldedIds', ['a', 'b']])
    expect(seeded.opens).toHaveLength(1)
    await ui.unmount()
  })

  test(`test_band_newArrivalAfterAFold_countsAndNamesOnlyTheArrival_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [...TWO, entry({ id: 'c', from: 'dave@acme' })], foldedIds: ['a', 'b'] })
    const ui = await mount($)
    const head = (await ui.find({ key: 'head' }))?.text
    expect(head).toContain('◆ rine  1 new — dave@acme (dm)')
    expect(head).not.toContain('bob@acme')
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.label)).toContain('Hand to Claude (1)')
    await ui.unmount()
  })
}

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const tailOf = (seeded: ReturnType<typeof seedUi>): unknown => seeded.rendered.filter((one) => one.component === 'PromptHint').at(-1)?.props.tail

test('test_promptHint_foldedUnread_addsTheTailLine', async ($, on) => {
  const seeded = seedUi(on, { entries: TWO, foldedIds: ['a', 'b'] })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'PromptHint', props: HINT as never })
  expect(tailOf(seeded)).toBe('◆ rine 2 new — /rine to open')
  await ui.unmount()
})

test('test_promptHint_arrivalAfterAFold_stillCountsEverythingFolded', async ($, on) => {
  const seeded = seedUi(on, { entries: [...TWO, entry({ id: 'c', from: 'dave@acme' })], foldedIds: ['a', 'b'] })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'PromptHint', props: HINT as never })
  expect(tailOf(seeded)).toBe('◆ rine 2 new — /rine to open')
  await ui.unmount()
})

test('test_promptHint_nothingFolded_leavesTheHintUntouched', async ($, on) => {
  const seeded = seedUi(on, { entries: TWO })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'PromptHint', props: HINT as never })
  expect(tailOf(seeded)).toBeUndefined()
  await ui.unmount()
})

test('test_promptHint_foldedEntryAlreadyRead_isNotCounted', async ($, on) => {
  const seeded = seedUi(on, { entries: [TWO[0], entry({ id: 'b', state: 'read' })], foldedIds: ['a', 'b'] })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'PromptHint', props: HINT as never })
  expect(tailOf(seeded)).toBe('◆ rine 1 new — /rine to open')
  await ui.unmount()
})

test('test_promptHint_muted_leavesTheHintUntouched', async ($, on) => {
  const seeded = seedUi(on, { entries: TWO, foldedIds: ['a', 'b'], prefs: { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false, isMotion: false } })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'terminal', component: 'PromptHint', props: HINT as never })
  expect(tailOf(seeded)).toBeUndefined()
  await ui.unmount()
})

test('test_promptSubmit_foldsTheListedEntriesAndPassesThePromptOn', async ($, on) => {
  const seeded = seedUi(on, { entries: [...TWO, entry({ id: 'x', list: 'deny' })] })
  const result = await $.prompt.submit({ text: 'hello' })
  expect(result).toEqual({ text: 'hello' })
  expect(seeded.sets).toContainEqual(['foldedIds', ['a', 'b']])
})
