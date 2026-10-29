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
    const ids = ['h1', 'u1', 'u2', 'e1', 'f1']
    expect(rows.map((b) => b.key).filter((key) => key?.startsWith('row:'))).toEqual(ids.map((id) => `row:${id}`))
    const heads = await Promise.all(['held', 'unread', 'earlier', 'filtered'].map(async (key) => (await ui.find({ key: `head:${key}` }))?.text ?? ''))
    expect(heads.map((text) => text.replace(/─+$/, ''))).toEqual(['▌ Held for review · 1 ', '▌ Unread · 2 ', '▌ Earlier, last 24h · 1 ', '▌ Filtered · 1 '])
    expect(heads.every((text) => text.endsWith('─'))).toBe(true)
    await ui.unmount()
  })

  test(`test_pane_header_namesHandlePhasePreviewMuteAndOwner_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [] })
    const ui = await mount($)
    const title = (await ui.find({ key: 'title' }))?.text ?? ''
    expect(title).toMatch(/^◆ rine {2}alice@acme +● live$/)
    // The row stops one cell short of the right edge, where Claude Code draws its close mark.
    expect(Array.from(title)).toHaveLength(PANE.bodyColumns - 1)
    expect(await ui.find({ type: 'Text', text: 'preview off · not muted · owner' })).toBeDefined()
    await ui.unmount()
  })

  test(`test_pane_row_showsSenderTypeSnippetAndDateInColumns_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, prefs: PREVIEW_ON, focusId: 'u1', 'isSelected:u1': true })
    const ui = await mount($)
    expect((await ui.find({ key: 'line:u1' }))?.text).toMatch(/^▸ ● bob@acme +task +not read yet +2m$/)
    expect((await ui.find({ key: 'line:u2' }))?.text).toMatch(/^ {2}● #ops@acme · carol@acme +reply +not read yet +4m$/)
    expect((await ui.find({ key: 'row:h1' }))?.text).toContain('decrypting…')
    expect((await ui.find({ key: 'row:u1' }))?.props.plain).toBe(true)
    // The whole line is one Button: its cells are Text children, the unread dot teal and the type tag, snippet and date dim.
    const row = await ui.find({ key: 'row:u1' })
    expect((await ui.find({ key: 'line:u1' }))?.children?.map((child) => child.type)).toEqual(['Button'])
    expect(row?.text).toMatch(/^▸ ● bob@acme +task +not read yet +2m$/)
    expect((row?.children ?? []).map((cell) => [cell.props?.color ?? null, cell.props?.dimColor ?? null])).toEqual([
      [null, null],
      ['#00BBA8', null],
      [null, null],
      [null, true],
      [null, true],
      [null, true]
    ])
    await ui.unmount()
  })

  test(`test_pane_filteredRow_drawsEveryCellDimIncludingTheUnreadDot_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, prefs: PREVIEW_ON })
    const ui = await mount($)
    const cells = (await ui.find({ key: 'row:f1' }))?.children ?? []
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) expect([cell.props?.color ?? null, cell.props?.dimColor ?? null]).toEqual([null, true])
    expect((await ui.find({ key: 'row:u1' }))?.children?.[1]?.props?.color).toBe('#00BBA8')
    await ui.unmount()
  })

  test(`test_pane_row_inANarrowPane_keepsTheNameAndTheAtOfALongSender_on_${surface}`, async ($, on) => {
    const sender = 'salesteam-eu-west@fjord21735'
    seedUi(on, { entries: [entry({ id: 'n1', from: sender })], prefs: PREVIEW_ON })
    const ui = await mount($, { ...PANE, bodyColumns: 20 })
    expect((await ui.find({ key: 'line:n1' }))?.text).toMatch(/salestea…@fjord…$/)
    await ui.unmount()
  })

  test(`test_pane_detail_remoteNamePastItsCells_keepsItsDomain_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [entry({ id: 'n1', from: `${'s'.repeat(50)}@fjord21735`, fromAgentId: 'agent-n1' })], focusId: 'n1' })
    const ui = await mount($)
    const from = (await ui.find({ key: 'detail:From' }))?.text ?? ''
    expect(from).toContain(`${'s'.repeat(28)}…@fjord21735 agent-n1`)
    await ui.unmount()
  })

  test(`test_pane_detail_narrowColumns_longRemoteName_keepsItsAt_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: [entry({ id: 'n1', from: 'procurement-team-europe-west@mx-ts-sdk-874177.rine.network', fromAgentId: 'agent-n1' })], focusId: 'n1' })
    const ui = await mount($, { ...PANE, bodyColumns: 40 })
    const from = (await ui.find({ key: 'detail:From' }))?.text ?? ''
    expect(from).toContain('@')
    expect(Array.from(from).length).toBeLessThanOrEqual(40)
    await ui.unmount()
  })

  test(`test_pane_detail_gridNamesFromToTypeReceivedEncryptionAndList_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, focusId: 'u2' })
    const ui = await mount($)
    const grid = await Promise.all(['From', 'Group', 'Type', 'Received', 'Encryption', 'List'].map(async (key) => (await ui.find({ key: `detail:${key}` }))?.text))
    expect(grid[0]).toBe('From       carol@acme agent-bo')
    expect(grid[1]).toBe('Group      #ops@acme g-1')
    expect(grid[2]).toBe('Type       reply')
    expect(grid[3]).toMatch(/^Received {3}4m · \d{4}-\d\d-\d\d \d\d:\d\d$/)
    expect(grid[4]).toBe('Encryption mls-v1')
    expect(grid[5]).toBe('List       none')
    expect((await ui.find({ key: 'detail:From' }))?.children?.[0]).toMatchObject({ props: { dimColor: true } })
    await ui.unmount()
  })

  test(`test_pane_buttons_groupUnderMessageTrustAndSession_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    for (const [group, labels] of [['Message', ['Read', 'Hand to Claude', 'Mark read', 'Reply']], ['Trust', ['Allow sender', 'Deny sender']], ['Session', ['Preview on', 'Mute', 'Whole org']]] as const) {
      const row = await ui.find({ key: `group:${group}` })
      expect(row?.children?.[0]).toMatchObject({ props: { dimColor: true } })
      expect(row?.text.startsWith(group)).toBe(true)
      expect((row?.children ?? []).filter((child) => child.type === 'Button').map((child) => child.props.label)).toEqual(labels)
    }
    await ui.unmount()
  })

  test(`test_pane_hint_followsTheFocusedEntryWhileFocusedAndTheKeysHintWhileNot_on_${surface}`, async ($, on) => {
    const seeded = seedUi(on, { entries: BOARD, focusId: 'u1' })
    const ui = await mount($)
    expect((await ui.find({ key: 'hint' }))?.text).toBe('r read · s hand to Claude · e mark read · y reply')
    await ui.unmount()
    seeded.values.focusId = 'h1'
    const held = await mount($)
    expect((await held.find({ key: 'hint' }))?.text).toBe('r read · a allow · d deny · esc close')
    await held.unmount()
    const away = await mount($, { ...PANE, isFocused: false })
    expect((await away.find({ key: 'hint' }))?.text).toBe('click here or ctrl+x tab to use the keys')
    await away.unmount()
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

  test(`test_pane_detail_keptFlagsWithoutTheirText_askForAReadAgain_on_${surface}`, async ($, on) => {
    seedUi(on, { entries: BOARD, focusId: 'u1', 'preview:u1': { status: 'ok', isVerified: true, hiddenChars: 3, truncatedChars: 7 } })
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'Press r to read the focused message.' })).toBeDefined()
    expect(await ui.find({ key: 'detail:Signature' })).toBeUndefined()
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
    expect(await labelsOf(ui)).toEqual(['Read', 'Hand to Claude', 'Mark read', 'Reply', 'Allow sender', 'Deny sender', 'Preview on', 'Mute', 'Whole org'])
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
    seedUi(on, { entries: [], prefs: { mutedUntil: 'forever', isMuteExplicit: true, isPreview: false, isMotion: false } })
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
    expect(bandLetters).toEqual(['o', 'h', 'm', 'u', 'l'])
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
      focusId: 'x'
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
