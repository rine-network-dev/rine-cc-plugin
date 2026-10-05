import { stateDir } from './refs'

/** The file tools the guard watches; `register.tsx` hooks each with `checkToolCall` and the `.catch` below. */
export const GUARDED_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const
export const GUARDED_SHELL_TOOL = 'Bash'

const MAX_WALK = 64
const SHELL_NAMES = /state\/cc|lists\.json|plugins\/store/

export const DENY_MANAGED = 'rine: those files are managed from /rine; ask the user to change them there.'
export const DENY_UNPLACED = 'rine: cannot tell where that path lands, so it is not written.'
export const DENY_GUARD_FAILED = 'rine: the file guard failed, so the call is not allowed.'

/** The `.catch` answer: a hook that throws is skipped unless the registration answers in its place. */
export function guardFailed(): { deny: string } {
  return { deny: DENY_GUARD_FAILED }
}

/** Where a path leads once symbolic links are followed, or undefined when it leads nowhere (`$.fs.stat` with `resolve`). */
export type RealPath = (path: string) => Promise<string | undefined>

/** `rineDirs`: where the session's state lives and where the live working directory would put it; a `cd` can split the two. */
export type GuardEnv = { rineDirs: readonly string[]; claudeConfigDir: string | undefined; home: string | undefined }
export type GuardInput = { tool: string; file_path?: unknown; notebook_path?: unknown; command?: unknown }
export type GuardVerdict = { deny: string } | null

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

function isPlaceableName(name: string): boolean {
  return !/^[A-Za-z]:/.test(name) && name !== '' && name !== '.' && name !== '..'
}

function isPlaceableSpelling(path: string): boolean {
  const drive = /^[A-Za-z]:(?![\\/])/.test(path)
  const network = /^[\\/][\\/]/.test(path)
  return !drive && !network && !path.startsWith('~') && isPlaceableName(path.slice(lastSeparator(path) + 1))
}

/**
 * Where the path lands (the d.ts `placed` pattern): the file if it stats, else the nearest folder above it that does,
 * plus the names below. Undefined when the spelling cannot be placed.
 */
export async function placed(realPath: RealPath, path: string): Promise<string | undefined> {
  if (!isPlaceableSpelling(path)) return undefined
  const tail: string[] = []
  let head = path
  for (let step = 0; step < MAX_WALK; step++) {
    const real = await realPath(head === '' ? '.' : head)
    if (real !== undefined) return [real.replace(/[\\/]$/, ''), ...tail.reverse()].join('/')
    const cut = lastSeparator(head)
    const name = head.slice(cut + 1)
    if (!isPlaceableName(name)) return undefined
    tail.push(name)
    head = cut < 0 ? '' : head.slice(0, Math.max(cut, 1))
  }
  return undefined
}

/** Case-folded: on a case-insensitive filesystem `realPath` keeps the spelling of a case alias. */
function isUnder(path: string, root: string): boolean {
  const [here, top] = [path.toLowerCase(), root.toLowerCase()]
  return here === top || here.startsWith(`${top}/`)
}

/** The folders no tool may write into: `<RINE_DIR>/state/cc/` and `<CLAUDE_CONFIG_DIR>/plugins/store/`. */
async function protectedRoots(realPath: RealPath, env: GuardEnv): Promise<string[] | undefined> {
  const configDir = env.claudeConfigDir ?? (env.home === undefined ? undefined : `${env.home}/.claude`)
  const dirs = [...env.rineDirs.map(stateDir), ...(configDir === undefined ? [] : [`${configDir}/plugins/store`])]
  const roots: string[] = []
  for (const dir of dirs) {
    const root = await placed(realPath, dir)
    if (root === undefined) return undefined
    roots.push(root)
  }
  return roots
}

function targetOf(e: GuardInput): string | undefined {
  const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  return typeof path === 'string' ? path : undefined
}

/**
 * Denies a file tool that lands under the state folder or the plugin store, or whose path cannot be placed, and
 * a Bash command that names them (best effort). Rejects when `realPath` throws; the registration's `.catch` denies.
 */
export async function checkToolCall(realPath: RealPath, env: GuardEnv, e: GuardInput): Promise<GuardVerdict> {
  if (e.tool === GUARDED_SHELL_TOOL) {
    return typeof e.command === 'string' && SHELL_NAMES.test(e.command) ? { deny: DENY_MANAGED } : null
  }
  const target = targetOf(e)
  const where = target === undefined ? undefined : await placed(realPath, target)
  const roots = await protectedRoots(realPath, env)
  if (where === undefined || roots === undefined) return { deny: DENY_UNPLACED }
  return roots.some((root) => isUnder(where, root)) ? { deny: DENY_MANAGED } : null
}
