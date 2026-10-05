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
    expect(head?.text).toContain('rine: 2 new — bob@acme (task), #ops@acme (reply)')
    expect(head?.text).toContain('ctrl+x tab')
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.label)).toEqual(['Open', 'Hand to Claude (2)', 'Mark read', 'Mute 1h'])
    expect(buttons.map((b) => b.props.hotkey)).toEqual(['o', 'h', 'm', 'u'])
    expect(buttons.every((b) => /^[a-z]$/.test(String(b.props.hotkey)))).toBe(true)
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
    ['muted', { entries: TWO, prefs: { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false } }, BAND],
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
      'preview:a': { status: 'ok', text: 'Can you rebase the branch and push it before lunch today please', isVerified: true }
    })
    const ui = await mount($)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.label)).toEqual(['Review', 'Mark read', 'Mute 1h'])
    expect(await ui.find({ type: 'Text', text: /^bob@acme: "Can you rebase the branch and push it .*…"$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: 'bob@acme: decrypting…' })).toHaveLength(2)
    await ui.unmount()
  })

  test(`test_band_fewRows_dropPreviewRowsBeforeAnyButton_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: HELD, prefs: { mutedUntil: null, isMuteExplicit: false, isPreview: true } })
    const tight = await mount($, { ...BAND, maxRows: 2 })
    expect(await tight.findAll({ type: 'Button' })).toHaveLength(3)
    expect(await tight.findAll({ type: 'Text', text: 'decrypting…' })).toEqual([])
    expect(await tight.find({ key: 'head' })).toBeDefined()
    await tight.unmount()
    const one = await mount($, { ...BAND, maxRows: 1 })
    expect(await one.findAll({ type: 'Button' })).toHaveLength(3)
    expect(await one.find({ key: 'head' })).toBeUndefined()
    expect(JSON.stringify(await one.drawn())).toContain('rine: 4 new')
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
}

