const pad = (n: number): string => String(n).padStart(2, '0')

/** An instant as `YYYY-MM-DD HH:MM` in the local time zone; an unparseable one reads an em dash. */
export function localStamp(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const at = new Date(ms)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** An epoch-millisecond instant as an ISO string; '' for one that is not a finite time, which `humanTime` reads as a dash. */
export const isoOfMs = (ms: number): string => (Number.isFinite(ms) ? new Date(ms).toISOString() : '')
