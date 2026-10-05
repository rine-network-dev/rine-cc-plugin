import { test, expect } from 'claude-code/testing'
import { at } from './at'
import { createRig, message } from './delivery-kit'

test('test_handoff_submits_the_hand_off_text_and_marks_the_entries_handed', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  const result = await rig.delivery.handOff(['aaaaaaaa-0001'])
  expect(result).toEqual({ status: 'submitted' })
  expect(rig.kit.sink.textsOf('submit')[0]).toContain('rine hand-off')
  expect(rig.view.entries[0]).toMatchObject({ disposition: 'handed', state: 'read' })
})

test('test_handoff_while_busy_reports_queued', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  await rig.delivery.turnStart({})
  expect(await rig.delivery.handOff(['aaaaaaaa-0001'])).toEqual({ status: 'queued' })
  expect(rig.kit.sink.textsOf('toast')).toContain('rine: queued for Claude')
})

test('test_handoff_dropped_submit_leaves_the_entries_alone', async () => {
  const rig = createRig()
  await rig.delivery.onMessage(message(), false)
  rig.kit.sink.submitResult = { isDropped: true, reason: 'no session' }
  expect(await rig.delivery.handOff(['aaaaaaaa-0001'])).toEqual({ status: 'dropped', reason: 'no session' })
  expect(at(rig.view.entries, 0).disposition).toBe('notified')
  expect(rig.kit.sink.textsOf('toast')).toContain('rine: hand-off dropped (no session)')
})

test('test_handoff_unknown_ids_submit_nothing', async () => {
  const rig = createRig()
  expect(await rig.delivery.handOff(['nope'])).toEqual({ status: 'empty' })
  expect(rig.kit.sink.textsOf('submit')).toEqual([])
})
