// The plugin's copy of rine-core/src/fit-party.ts (the plugin cannot import rine-core). The two are held to one vector
// file, rine-core/test/fixtures/fit-party-vectors.json, through tests/fit-party-vectors.ts.
import { displayWidth, safeLine } from './sanitize'

/** The joint between a group and its sender in a `#group · sender` label. */
export const GROUP_JOINT = ' · '
/** The share of a `#group · sender` row's room the group may take; the sender keeps the rest. */
const GROUP_SHARE = 0.6
/** The share of a `from → to` row's room the sender may take before the recipient is out of room. */
const PAIR_SHARE = 0.5
/** The fewest cells a bare name keeps while the room holds two parties. */
const BARE_FLOOR = 4

/** Index of the `@` that starts a remote label's domain; -1 for a bare name (a leading or trailing `@` is no domain). */
function domainAt(label: string): number {
  const at = label.lastIndexOf('@')
  return at > 0 && at < label.length - 1 ? at : -1
}

/** The name characters a clipped remote label keeps in front of its ellipsis: one, or `#` and one for a group. */
const nameFloor = (label: string): number => (label.startsWith('#') ? 2 : 1)

/** The cells a remote label needs to show `x…@…` (`#m…@…` for a group). */
const remoteFloor = (label: string): number => nameFloor(label) + 3

/** What a label that cannot show `x…@…` keeps: `…@…`, then `…@`, then `@`. The `@` of a remote label never goes. */
const narrowForm = (cells: number): string => (cells >= 3 ? '…@…' : cells === 2 ? '…@' : cells === 1 ? '@' : '')

/**
 * A handle label fitted to `cells` columns. A bare name clips from the right. A remote `local@domain` label never loses
 * its `@`, so it never reads like an own one, and its name comes before its domain: the local part keeps about half
 * the cells in name characters (everything a short domain leaves, or its whole self when `keepName`) and the domain
 * clips from the right, down to `…`, so `salesteam-europe@fjord21735` in 16 cells reads `salestea…@fjord…`. Below
 * `x…@…` (`#m…@…` for a group, which keeps a name character after its `#`) the label is `…@…`, `…@` at 2 cells, `@`
 * at 1. Not padded. `label` must already be scrubbed (one line, no control or zero-width characters); the twins agree
 * only on scrubbed input.
 */
function fitLabel(label: string, cells: number, keepName: boolean): string {
  if (displayWidth(label) <= cells) return label
  const at = domainAt(label)
  if (at < 0) return safeLine(label, cells)
  if (!keepName && cells < remoteFloor(label)) return narrowForm(cells)
  const local = label.slice(0, at)
  const localWidth = displayWidth(local)
  const want = keepName ? localWidth : Math.max(Math.ceil(cells / 2) + 1, cells - 1 - displayWidth(label.slice(at + 1)))
  const head = safeLine(local, Math.min(localWidth, cells - 2, Math.max(want, nameFloor(label) + 1)))
  return `${head}@${safeLine(label.slice(at + 1), cells - 1 - displayWidth(head))}`
}

/** `label` fitted to `cells` columns: see `fitLabel`. */
export const fitHandle = (label: string, cells: number): string => fitLabel(label, cells, false)

/** The cells a party needs to show its whole name: the whole bare name, or the local part with a clipped domain `name@…`. */
function needOf(label: string): number {
  const at = domainAt(label)
  const whole = displayWidth(label)
  return at < 0 ? whole : Math.min(whole, displayWidth(label.slice(0, at)) + 2)
}

/** The fewest cells a party keeps while the room holds two: `x…@…` for a remote label, as many cells for a bare name. */
const floorOf = (label: string): number =>
  Math.min(displayWidth(label), domainAt(label) < 0 ? BARE_FLOOR : remoteFloor(label))

/** A party fitted to the cells its pair gave it; one whose whole name fits keeps it and clips only its domain. */
const fitParty = (label: string, cells: number): string => fitLabel(label, cells, needOf(label) <= cells)

/**
 * Two labels sharing `room` columns. When both fit they are left alone. Otherwise the lead takes what the tail does not
 * need to show its whole name, but never more than `share` of the room unless the tail needs less. Each party keeps its
 * floor (see `floorOf`) while the room holds both, so both keep their `@`; a party that gets room for its whole name
 * keeps it and gives up its domain first.
 */
function fitPair(lead: string, tail: string, room: number, share: number): [string, string] {
  const leadCells = displayWidth(lead)
  if (leadCells + displayWidth(tail) <= room) return [lead, tail]
  const capped = Math.min(leadCells, Math.max(Math.floor(room * share), room - needOf(tail)))
  const leadFloor = floorOf(lead)
  const tailFloor = floorOf(tail)
  const leadRoom = leadFloor + tailFloor <= room ? Math.min(Math.max(capped, leadFloor), room - tailFloor) : capped
  return [fitParty(lead, leadRoom), fitParty(tail, room - leadRoom)]
}

/** `[group, sender]` of a `#group · sender` row in `room` columns (the joint excluded): the group takes at most 60 % unless the sender needs less. */
export const fitGroupSender = (group: string, sender: string, room: number): [string, string] =>
  fitPair(group, sender, room, GROUP_SHARE)

/** `[from, to]` of a `from → to` row in `room` columns (the joint excluded): the recipient gets what it needs, or half. */
export const fitFromTo = (from: string, to: string, room: number): [string, string] => fitPair(from, to, room, PAIR_SHARE)
