import type { OrgFrame } from './org-frames'
import { LINE_CELLS } from './org-rows'
import type { OrgFinding, OrgStore } from './org-window'
import { safeLine } from './sanitize'
import { shownHandle } from './shown-handle'
import { wrapText } from './wrap'

/** The most findings kept; older ones drop, as older rows do. */
export const FINDINGS_LIMIT = 200
export const FINDINGS_TRIMMED = 'Older findings are not kept here.'
const SHORT_ID_CHARS = 8
const GROUP_CELLS = 48

/** Adds a finding in front, unless that group already has that gap; the newest `FINDINGS_LIMIT` stay. */
export function addOrgFinding(store: OrgStore, { groupId, gapKey, sentence }: Extract<OrgFrame, { kind: 'finding' }>): void {
  if (store.findings.some((found) => found.groupId === groupId && found.gapKey === gapKey)) return
  store.findings.unshift({ groupId, gapKey, sentence })
  store.findings.splice(FINDINGS_LIMIT)
}

/** A finding as one sentence naming its group: the handle (which already starts with `#`) when a loaded row of the group knows it, else the id's first characters. */
function describe(handles: ReadonlyMap<string, string>, { groupId, sentence }: OrgFinding): string {
  return safeLine(`In ${handles.get(groupId) ?? groupId.slice(0, SHORT_ID_CHARS)}: ${sentence}`, LINE_CELLS)
}

function handlesOf(store: OrgStore): Map<string, string> {
  const handles = new Map<string, string>()
  const ownSlug = store.org?.slug ?? null
  for (const { message } of store.rows.values()) {
    if (message.groupId !== null && message.groupHandle !== null) handles.set(message.groupId, shownHandle(message.groupHandle, ownSlug, GROUP_CELLS))
  }
  return handles
}

/**
 * What the tab draws of the findings, from one scan of the rows for the group handles: the compact bar (no lines while
 * there are none), and, when the list is open, every finding newest first. Both wrap to `columns` instead of clipping.
 */
export function findingsView(store: OrgStore, columns: number, isListed: boolean): { bar: string[]; lines: string[] } {
  const [latest] = store.findings
  if (latest === undefined) return { bar: [], lines: [] }
  const handles = handlesOf(store)
  const count = store.findings.length
  return {
    bar: wrapText(`${count} ${count === 1 ? 'finding' : 'findings'} · f lists them · ${describe(handles, latest)}`, columns),
    lines: isListed ? store.findings.flatMap((found) => wrapText(describe(handles, found), columns)) : []
  }
}
