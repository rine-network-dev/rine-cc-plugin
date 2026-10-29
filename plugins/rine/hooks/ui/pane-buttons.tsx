import type { RenderNode } from 'claude-code'
import type { RinePhase } from '../../types/index'
import type { Ui } from './cells'

type Job = () => void | Promise<void>

/** What each button does; the pane builds them over `$`, so the buttons draw without ever holding the engine. */
export type PaneJobs = {
  read: Job
  hand: Job
  mark: Job
  reply: Job
  confirm: Job
  allowSender: Job
  denySender: Job
  allowGroup: Job
  denyGroup: Job
  cancel: Job
  preview: Job
  mute: Job
  reconnect: Job
  takeover: Job
  org: Job
}

export type ButtonsSpec = {
  jobs: PaneJobs
  /** An entry is focused. */
  hasFocus: boolean
  isGroup: boolean
  /** The focused group's `Allow` is awaiting its second press. */
  isWarned: boolean
  isTrusted: boolean
  isPreview: boolean
  isQuiet: boolean
  isOwner: boolean
  phase: RinePhase
}

const GROUP_CELLS = 9
const label = (name: string): string => name.padEnd(GROUP_CELLS)
const isDown = (phase: RinePhase): boolean => phase === 'backoff' || phase === 'offline' || phase === 'auth-failed'

/** The buttons in three rows with a dim leading label: the message, the trust decision, the session. */
export function actionRows(ui: Ui, s: ButtonsSpec) {
  const { Box, Text, Button } = ui
  const { jobs } = s
  const hasSender = s.hasFocus && !s.isGroup
  const message = [
    <Button key="read" label="Read" hotkey="r" onPress={jobs.read} />,
    <Button key="hand" label="Hand to Claude" hotkey="s" variant="primary" onPress={jobs.hand} />,
    <Button key="mark" label="Mark read" hotkey="e" onPress={jobs.mark} />,
    hasSender && <Button key="reply" label="Reply" hotkey="y" onPress={jobs.reply} />
  ]
  const trust = [
    !s.isTrusted && !s.isWarned && <Button key="confirm" label="Confirm" hotkey="c" onPress={jobs.confirm} />,
    hasSender && <Button key="allow" label="Allow sender" hotkey="a" onPress={jobs.allowSender} />,
    hasSender && <Button key="deny" label="Deny sender" hotkey="d" onPress={jobs.denySender} />,
    s.isGroup && <Button key="allow-group" label={s.isWarned ? 'Allow' : 'Allow group'} hotkey="g" onPress={jobs.allowGroup} />,
    s.isGroup && !s.isWarned && <Button key="deny-group" label="Deny group" hotkey="k" onPress={jobs.denyGroup} />,
    s.isWarned && <Button key="cancel" label="Cancel" hotkey="c" onPress={jobs.cancel} />
  ]
  const session = [
    <Button key="preview" label={s.isPreview ? 'Preview off' : 'Preview on'} hotkey="p" onPress={jobs.preview} />,
    <Button key="mute" label={s.isQuiet ? 'Unmute' : 'Mute'} hotkey="q" onPress={jobs.mute} />,
    isDown(s.phase) && <Button key="reconnect" label="Reconnect" hotkey="x" onPress={jobs.reconnect} />,
    !s.isOwner && <Button key="takeover" label="Take over" hotkey="t" onPress={jobs.takeover} />,
    <Button key="org" label="Whole org" hotkey="w" onPress={jobs.org} />
  ]
  /** A row with nothing to press is not drawn. */
  const rowOf = (name: string, buttons: (RenderNode | false)[]) => {
    const shown = buttons.filter((button): button is RenderNode => button !== false)
    if (shown.length === 0) return null
    return (
      <Box key={`group:${name}`} flexDirection="row" flexWrap="wrap">
        <Text key="label" dimColor>{label(name)}</Text>
        {shown}
      </Box>
    )
  }
  return [rowOf('Message', message), rowOf('Trust', trust), rowOf('Session', session)]
}
