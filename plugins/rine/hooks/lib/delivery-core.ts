import type { RineEntry, RineIdentity, RineMode, RinePreview } from '../../types/index'
import type { ListsView } from './lists'
import type { NoteEntry } from './model-text'

/** Everything a delivery decision reads, taken from `$.state` and the lists and prefs files in one snapshot. */
export type DeliveryView = {
  entries: readonly RineEntry[]
  mode: RineMode
  identity: RineIdentity
  lists: ListsView
  isPreview: boolean
  isMuted: boolean
  isOwner: boolean
  isBusy: boolean
  pendingWake: boolean
  wakeCooldownUntil: number | null
  permissionMode: string | null
}

export type DeliveryFlags = Pick<DeliveryView, 'isBusy' | 'pendingWake' | 'wakeCooldownUntil'>

/** The `$.state` side of delivery; `register.tsx` backs it (a lib file never receives `$`). */
export type DeliveryStore = {
  read: () => Promise<DeliveryView>
  updateEntries: (edit: (entries: readonly RineEntry[]) => RineEntry[]) => Promise<void>
  patch: (changes: Partial<DeliveryFlags>) => Promise<void>
  setPreview: (id: string, preview: RinePreview) => Promise<void>
}

/** Raises the toast for one arrival; the toaster batches and appends the system notice. */
export type Say = (entry: RineEntry, text: string) => void

export function toNote(entry: RineEntry): NoteEntry {
  return {
    id: entry.id,
    from: entry.from,
    type: entry.type,
    group: entry.group,
    sentAt: entry.createdAt,
    isWebhook: entry.isWebhook
  }
}
