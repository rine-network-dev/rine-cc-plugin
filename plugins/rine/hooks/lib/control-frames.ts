/** A sealed group-key message: machine-parsed key material, never conversation. */
const SENDER_KEY_DISTRIBUTION_TYPE = 'rine.v1.sender_key_distribution'
const GROUP_INVITE_TYPE = 'rine.v1.group_invite'

/** Whether a message type is key material, which neither wakes a turn nor reaches the model or the inbox. */
export function isHiddenFromModel(type: string): boolean {
  return type === SENDER_KEY_DISTRIBUTION_TYPE
}

export function isGroupInvite(type: string): boolean {
  return type === GROUP_INVITE_TYPE
}

/**
 * The one sentence a model sees for a group invite, whatever the invite's body says.
 * The same wording as rine-core's `groupInviteNotice`, which `tests/control-frames.test.ts`
 * holds it to through the shared invite-notice vectors.
 */
export function groupInviteNotice(fromHandle: string | null): string {
  const from = fromHandle === null ? 'Group invite received.' : `Group invite from ${fromHandle}.`
  return `${from} Check your pending invites with rine_group_invites.`
}
