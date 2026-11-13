import { test, expect } from 'claude-code/testing'
import { groupInviteNotice } from '../hooks/lib/control-frames'
import { INVITE_NOTICE_VECTORS } from './invite-notice-vectors'

INVITE_NOTICE_VECTORS.forEach((v, i) => {
  test(`test_groupInviteNotice_sharedVector_${v.handle === null ? 'noHandle' : `named_${i}`}`, async () => {
    expect(groupInviteNotice(v.handle)).toBe(v.expected)
  })
})
