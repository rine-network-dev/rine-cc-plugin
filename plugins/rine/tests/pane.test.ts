import { expect, test, type Engine } from 'claude-code/testing'
import { BAND, entry, NOW, PANE, seedUi, SURFACES } from './ui-kit'

const HOUR = 3_600_000
const BOARD = [
  entry({ id: 'h1', disposition: 'held', receivedAt: NOW - 60_000, from: 'bob@acme' }),
  entry({ id: 'u1', receivedAt: NOW - 120_000, from: 'bob@acme', type: 'rine.v1.task', list: 'allow' }),
  entry({ id: 'u2', receivedAt: NOW - 240_000, from: 'carol@acme', group: '#ops@acme', groupId: 'g-1', type: 'rine.v1.reply', encryption: 'mls-v1' }),
  entry({ id: 'e1', state: 'read', receivedAt: NOW - HOUR }),
  entry({ id: 'old', state: 'read', receivedAt: NOW - 25 * HOUR }),
  entry({ id: 'f1', list: 'deny', receivedAt: NOW - 300_000, from: 'mallory@acme' })
]
const OFFLINE = { phase: 'offline', attempt: 6, lastFrameAt: NOW, nextRetryAt: null, ownerCwd: null, unreadable: 0 }
const PREVIEW_ON = { mutedUntil: null, isMuteExplicit: false, isPreview: true }

for (const surface of SURFACES) {
  const mount = ($: Engine, props: Record<string, unknown> = PANE) =>
    $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: 'rine-inbox', props: props as never })
  const labelsOf = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Button' })).filter((b) => !b.key?.startsWith('row:')).map((b) => String(b.props.label))

  test(`test_pane_entries_groupIntoSectionsNewestFirstAndDropOldRead_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, prefs: PREVIEW_ON })
    const ui = await mount($)
    const rows = await ui.findAll({ type: 'Button' })
    expect(rows.map((b) => b.key).filter((key) => key?.startsWith('row:'))).toEqual(['row:h1', 'row:u1', 'row:u2', 'row:e1', 'row:f1'])
    const titles = (await ui.findAll({ type: 'Text' })).map((t) => t.text).filter((text) => text.startsWith('──'))
    expect(titles).toEqual(['── Held for review (1) ──', '── Unread (2) ──', '── Earlier, last 24h (1) ──', '── Filtered (1) ──'])
    await ui.unmount()
  })

  test(`test_pane_header_namesHandlePhasePreviewMuteAndOwner_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [] })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'alice@acme.rine.network · ● live · preview off · not muted · owner' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_row_showsSenderTypeAgeEncryptionAndList_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, prefs: PREVIEW_ON, 'isSelected:u1': true, 'preview:h1': { status: 'ok', text: 'Can you rebase', isVerified: true } })
    const ui = await mount($)
    expect((await ui.find({ key: 'row:u1' }))?.props.label).toBe('[•] bob@acme · task · 2m · hpke-v1 · allow')
    expect((await ui.find({ key: 'row:u2' }))?.props.label).toBe('[ ] carol@acme in #ops@acme · reply · 4m · mls-v1 · none')
    expect((await ui.find({ key: 'row:h1' }))?.props.label).toContain('"Can you rebase"')
    await ui.unmount()
  })

  test(`test_pane_rowPress_togglesSelectionAndFocusesTheRow_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD })
    const ui = await mount($)
    await ui.press({ key: 'row:u1' })
    expect(seeded.sets).toEqual([['isSelected:u1', true], ['focusId', 'u1']])
    await ui.press({ key: 'row:u1' })
    expect(seeded.sets[2]).toEqual(['isSelected:u1', false])
    await ui.unmount()
  })

  test(`test_pane_detail_showsScrubbedPreviewWithItsMarkers_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, focusId: 'u1', 'preview:u1': { status: 'ok', text: 'hello', isVerified: true, hiddenChars: 3, truncatedChars: 7 } })
    const ui = await mount($)
    for (const text of ['verified ✓', 'hello', '+7 chars not shown', '3 hidden/control characters removed']) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  })

  test(`test_pane_detail_loadingErrorAndUnreadStates_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    for (const [preview, shown] of [[undefined, 'Press r to read'], [{ status: 'loading' }, 'decrypting…'], [{ status: 'error' }, 'Could not read']] as const) {
      seeded.values['preview:u1'] = preview
      const ui = await mount($)
      expect(await ui.find({ type: 'Text', text: shown })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`test_pane_buttons_followTheFocusedEntryAndTheSession_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    expect(await labelsOf(ui)).toEqual(['Read', 'Hand to Claude', 'Mark read', 'Reply', 'Allow sender', 'Deny sender', 'Preview on', 'Mute'])
    await ui.unmount()
    Object.assign(seeded.values, {
      focusId: 'u2', isOwner: false, isListsTrusted: false,
      stream: { ...OFFLINE, lastFrameAt: null }
    })
    const other = await mount($)
    const labels = await labelsOf(other)
    expect(labels).toEqual(expect.arrayContaining(['Confirm', 'Allow group', 'Deny group', 'Reconnect', 'Take over']))
    expect(labels).not.toContain('Reply')
    expect(labels).not.toContain('Allow sender')
    expect(await other.find({ type: 'Text', text: /Lists changed outside \/rine/ })).toBeDefined()
    await other.unmount()
  })

  test(`test_pane_mutedSession_offersUnmute_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [], prefs: { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false } })
    const ui = await mount($)
    expect(await labelsOf(ui)).toContain('Unmute')
    expect(await ui.find({ type: 'Text', text: /muted/ })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_legacyPausedSession_offersUnmute_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [], isLegacyPaused: true })
    const ui = await mount($)
    expect(await labelsOf(ui)).toContain('Unmute')
    expect(await ui.find({ type: 'Text', text: /· muted/ })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_allowGroup_warnsBeforeAnythingIsListed_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u2' })
    const ui = await mount($)
    await ui.press({ key: 'allow-group' })
    const warning = 'Any member of #ops@acme, including anyone who joins later, can start a turn.'
    expect(await ui.find({ type: 'Text', text: warning })).toBeDefined()
    const labels = await labelsOf(ui)
    expect(labels).toEqual(expect.arrayContaining(['Allow', 'Cancel']))
    expect(labels).not.toContain('Deny group')
    expect(seeded.sets).toEqual([['groupWarnId', 'u2']])
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ type: 'Text', text: warning })).toBeUndefined()
    await ui.unmount()
  })

  test(`test_pane_replyPress_opensTheReplyPaneAsAFocusedDialog_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    await ui.press({ key: 'reply' })
    expect(seeded.opens).toEqual([{ id: 'rine-reply', title: 'Reply to bob@acme', focus: true, closeOnEscape: true }])
    await ui.unmount()
  })

  test(`test_pane_replyPress_whenTheReplyPaneDoesNotOpen_reopensTheInbox_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    seeded.isPlaced = false
    const ui = await mount($)
    await ui.press({ key: 'reply' })
    expect(seeded.order).toEqual(['close:rine-inbox', 'open:rine-reply', 'open:rine-inbox'])
    expect(seeded.toasts).toEqual(['rine: the reply pane did not open'])
    await ui.unmount()
  })

  test(`test_pane_replyPress_closesTheInboxBeforeOpeningTheReplyPane_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    await ui.press({ key: 'reply' })
    expect(seeded.order).toEqual(['close:rine-inbox', 'open:rine-reply'])
    await ui.unmount()
  })

  test(`test_pane_letters_neverCollideWithEachOtherOrTheBand_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD })
    const band = await $.ui.mount({ plugin: 'rine', surface, component: 'AbovePrompt', props: BAND as never })
    const bandLetters = (await band.findAll({ type: 'Button' })).map((b) => String(b.props.hotkey))
    await band.unmount()
    expect(bandLetters.length).toBeGreaterThan(0)
    const states = [
      { focusId: 'u1', isOwner: false, isListsTrusted: false, stream: OFFLINE },
      { focusId: 'u2', isOwner: true, isListsTrusted: true, stream: { ...OFFLINE, phase: 'live' } },
      { focusId: 'u2', groupWarnId: 'u2' }
    ]
    for (const state of states) {
      Object.assign(seeded.values, state)
      const ui = await mount($)
      const buttons = (await ui.findAll({ type: 'Button' })).filter((b) => !b.key?.startsWith('row:'))
      const letters = buttons.map((b) => String(b.props.hotkey))
      expect(new Set(letters).size).toBe(letters.length)
      expect(letters.filter((letter) => bandLetters.includes(letter))).toEqual([])
      await ui.unmount()
    }
  })

  test(`test_pane_withoutTheKeyboard_hintsHowToGetIt_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [] })
    const ui = await mount($, { ...PANE, isFocused: false })
    expect(await ui.find({ type: 'Text', text: 'click here or ctrl+x tab to use the keys' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_withTheKeyboard_drawsNoHint_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [] })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`test_pane_hostileFields_drawStripped_on_${surface}`, async ($, on) => {
    seedUi(on, {
      entries: [entry({ id: 'x', from: 'bo\x1b[31mb‮@acme\u{E0041}', encryption: 'a\x1b]0;t\x07b' })],
      focusId: 'x',
      'preview:x': { status: 'ok', text: 'clean', isVerified: true }
    })
    const ui = await mount($)
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/\\u001b|\\u202e|‮|\u{E0041}/u)
    await ui.unmount()
  })

  test(`test_pane_beforeTheStateIsWritten_saysItIsStarting_on_${surface}`, async ($, on) => {
    seedUi(on, { stream: undefined })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'rine is starting…' })).toBeDefined()
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  const mount = ($: Engine) =>
    $.ui.mount({ plugin: 'rine', surface, component: 'Pane', requestId: 'rine-reply', props: PANE as never })

  test(`test_replyPane_draftAndEnter_sendsThroughMcpAndCloses_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1', 'replyDraft:u1': 'ok' })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'Reply to bob@acme (1:1). Enter sends, Esc cancels.' })).toBeDefined()
    expect((await ui.find({ key: 'reply' }))?.props.value).toBe('ok')
    await ui.input({ key: 'reply', text: 'ok then', kind: 'change' })
    expect(seeded.sets).toEqual([['replyDraft:u1', 'ok then']])
    await ui.input({ key: 'reply', text: 'ok then' })
    expect(seeded.calls).toEqual([{ server: 'plugin:rine:rine', tool: 'rine_reply', args: { message_id: 'u1', payload: { text: 'ok then' } } }])
    expect(seeded.closes).toEqual(['rine-reply'])
    expect(seeded.toasts).toEqual(['rine: reply sent'])
    expect(seeded.values['replyDraft:u1']).toBe('')
    await ui.unmount()
  })

  test(`test_replyPane_emptyEnter_sendsNothing_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    await ui.input({ key: 'reply', text: '   ' })
    expect(seeded.calls).toEqual([])
    expect(seeded.closes).toEqual([])
    await ui.unmount()
  })

  test(`test_replyPane_failedSend_keepsThePaneAndTheDraft_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    seeded.isCallFailing = true
    const ui = await mount($)
    await ui.input({ key: 'reply', text: 'ok' })
    expect(seeded.toasts).toEqual(['rine: reply not sent, try again'])
    expect(seeded.closes).toEqual([])
    expect(seeded.sets).toEqual([])
    await ui.unmount()
  })

  test(`test_replyPane_groupEntry_hasNothingToReplyTo_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, focusId: 'u2' })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'Nothing to reply to.' })).toBeDefined()
    expect(await ui.find({ key: 'reply' })).toBeUndefined()
    await ui.unmount()
  })
}

test('test_replyPane_surfaceWithoutInput_sendsThePersonToTheTerminal', async ($, on) => {
  seedUi(on, { entries: BOARD, focusId: 'u1' })
  const ui = await $.ui.mount({ plugin: 'rine', surface: 'mobile', component: 'Pane', requestId: 'rine-reply', props: PANE as never })
  expect(await ui.find({ type: 'Text', text: /reply from the terminal/ })).toBeDefined()
  expect(await ui.find({ type: 'Box' })).toBeUndefined()
  await ui.unmount()
})
