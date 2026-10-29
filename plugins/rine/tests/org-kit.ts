import { parseOrgFrame } from '../hooks/lib/org-frames'
import { addOrgRow, type OrgStore } from '../hooks/lib/org-window'
import { FEED_CONTRACT_LINES } from './feed-contract'

/** The cursor a filled store offers for older rows. */
export const OLDER_CURSOR = 'older-1'

/** The message rows of the feed contract, in order. */
export const CONTRACT_ROWS = FEED_CONTRACT_LINES.map(parseOrgFrame).flatMap((frame) => (frame.kind === 'row' ? [frame] : []))

/** Fills the store with the contract rows and an older cursor. */
export function fillOrgStore(store: OrgStore): void {
  for (const row of CONTRACT_ROWS) addOrgRow(store, row)
  store.olderCursor = OLDER_CURSOR
}
