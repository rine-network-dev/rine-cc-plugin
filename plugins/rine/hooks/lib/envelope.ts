import type { Ports } from './ports'

const HEADER = /^[0-9a-f]{64}$/

export async function digestHex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function seal(body: string): Promise<string> {
  return `${await digestHex(body)}\n${body}`
}

export async function open(text: string): Promise<string | null> {
  const cut = text.indexOf('\n')
  if (cut < 0) return null
  const head = text.slice(0, cut)
  const body = text.slice(cut + 1)
  if (!HEADER.test(head)) return null
  return head === (await digestHex(body)) ? body : null
}

export type Sealed = { status: 'absent' } | { status: 'unknown' } | { status: 'ok'; body: string; value: unknown }

async function parseSealed(text: string): Promise<Sealed> {
  const body = await open(text)
  if (body === null) return { status: 'unknown' }
  try {
    return { status: 'ok', body, value: JSON.parse(body) }
  } catch {
    return { status: 'unknown' }
  }
}

export async function readSealed(ports: Pick<Ports, 'fs' | 'clock'>, path: string): Promise<Sealed> {
  const first = await ports.fs.read(path)
  if (first === undefined) return { status: 'absent' }
  const outcome = await parseSealed(first)
  if (outcome.status !== 'unknown') return outcome
  await ports.clock.sleep(100)
  const second = await ports.fs.read(path)
  if (second === undefined) return { status: 'absent' }
  return parseSealed(second)
}

export async function writeSealed(ports: Pick<Ports, 'fs'>, path: string, value: unknown): Promise<string> {
  const body = JSON.stringify(value)
  await ports.fs.write(path, await seal(body))
  return body
}

export type Updated<T> = { status: 'ok'; value: T } | { status: 'unchanged' } | { status: 'failed' }

function sameJson(next: unknown, stored: unknown): boolean {
  return JSON.stringify(next) === JSON.stringify(stored)
}

/**
 * The writer rule: read, edit, write, read back after 200 ms, and retry once on a mismatch. `edit`
 * answers undefined for "no change". A write that throws reads as failed.
 */
export async function updateSealed<T>(
  ports: Pick<Ports, 'fs' | 'clock'>,
  path: string,
  edit: (current: Sealed) => T | undefined | Promise<T | undefined>,
  isStored: (next: T, stored: unknown) => boolean = sameJson
): Promise<Updated<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = await edit(await readSealed(ports, path))
    if (next === undefined) return { status: 'unchanged' }
    try {
      await writeSealed(ports, path, next)
    } catch {
      return { status: 'failed' }
    }
    await ports.clock.sleep(200)
    const back = await readSealed(ports, path)
    if (back.status === 'ok' && isStored(next, back.value)) return { status: 'ok', value: next }
  }
  return { status: 'failed' }
}
