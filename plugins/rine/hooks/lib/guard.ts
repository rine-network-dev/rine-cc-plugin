import { runsOrgView } from './guard-tui'
import { stateDir } from './refs'

/** The file tools the guard watches; `register.tsx` hooks each with `checkToolCall` and the `.catch` below. */
export const GUARDED_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const
/** The tools that run a shell `command`; each is held to the same checks as Bash. */
export const GUARDED_SHELL_TOOLS = ['Bash', 'Monitor', 'PowerShell'] as const
/** The read tools the guard watches for the owner's secrets; they are never otherwise restricted. */
export const GUARDED_READ_TOOLS = ['Read', 'Grep', 'Glob'] as const

const isShellTool = (tool: string): boolean => (GUARDED_SHELL_TOOLS as readonly string[]).includes(tool)

const MAX_WALK = 64
const SHELL_NAMES = /state\/cc|lists\.json|plugins\/store/

/**
 * The owner's secret files by name, wherever the owner dir lives: the org root key, the recovery phrase file and a
 * branch's signing or reading key. Applied to the path arguments of a call and to a Bash command, never to a Grep regex.
 */
const SECRET_FILE = /(?<![\w.-])(?:root\.key|recovery-phrase\.txt)(?![\w.-])|branch[\\/][^\\/\s'"]+[\\/](?:sign|read)\.key/i
/** What a glob word in a shell command could expand to inside the owner dir; `x` stands for any branch name. */
const OWNER_FILES = ['root.key', 'recovery-phrase.txt', 'token_cache.json', 'branch/x/sign.key', 'branch/x/read.key']

export const DENY_OWNER_SECRET = 'rine: the org root key and recovery phrase belong to the owner; they are never read or edited in a session.'
export const DENY_ORG_VIEW = 'rine: the org view is for people, not the model; ask the user to run rine tui in their own terminal.'
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
export type GuardEnv = {
  rineDirs: readonly string[]
  claudeConfigDir: string | undefined
  home: string | undefined
  /** `RINE_OWNER_DIR`; the default owner dir under `home` applies when it is unset. */
  ownerDir: string | undefined
}
export type GuardInput = {
  tool: string
  file_path?: unknown
  notebook_path?: unknown
  command?: unknown
  path?: unknown
  pattern?: unknown
  glob?: unknown
}
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
  const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path ?? e.path
  return typeof path === 'string' ? path : undefined
}

/** The owner dir where it really lands, or undefined when there is none to place. */
async function ownerRoot(realPath: RealPath, env: GuardEnv): Promise<string | undefined> {
  const dir = env.ownerDir ?? (env.home === undefined ? undefined : `${env.home}/.config/rine-owner`)
  return dir === undefined ? undefined : placed(realPath, dir)
}

function globPattern(word: string): RegExp {
  const body = word.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*|[*?]/g, (g) => (g === '**' ? '.*' : g === '*' ? '[^/]*' : '[^/]'))
  return new RegExp(`^${body}$`, 'i')
}

/** A shell word as a path: `~`, `$HOME` and `$RINE_OWNER_DIR` expanded, or undefined when the word is not absolute once expanded. */
function expanded(word: string, env: GuardEnv): string | undefined {
  const home = env.home ?? ''
  const owner = env.ownerDir ?? ''
  const path = word.replace(/^~(?=\/|$)/, home).replace(/\$\{?HOME\}?/g, home).replace(/\$\{?RINE_OWNER_DIR\}?/g, owner)
  return path.startsWith('/') ? path.replace(/\/+$/, '') : undefined
}

/** The words that can name a path: a Bash command split at spaces, quotes and operators, or a Glob pattern. */
function wordsOf(e: GuardInput): string[] {
  const text = isShellTool(e.tool) ? e.command : e.tool === 'Glob' ? e.pattern : undefined
  return typeof text === 'string' ? text.split(/[\s;&|<>()"'`=]+/).filter((word) => word !== '') : []
}

/** Whether a Bash word leads into the owner dir: it lands under it, or it is a glob that could expand to one of its files. */
async function shellWordReachesOwner(realPath: RealPath, env: GuardEnv, root: string, word: string): Promise<boolean> {
  const path = expanded(word, env)
  if (path === undefined) return false
  if (/[*?]/.test(path)) return OWNER_FILES.some((file) => globPattern(path).test(`${root}/${file}`))
  const where = await placed(realPath, path)
  return where !== undefined && isUnder(where, root)
}

/**
 * Whether the call reaches the owner's secrets. A file path is matched by name and by where it really lands (symbolic links followed); a Grep or Glob
 * `path` that contains the owner dir is refused too, since a search from there reads it. A Grep regex is content, not a path, and is not matched. A
 * Bash command is matched by name and word by word; a relative word after a `cd` into the owner dir is not seen.
 */
async function reachesOwnerSecrets(realPath: RealPath, env: GuardEnv, e: GuardInput, where: string | undefined): Promise<boolean> {
  const names = [targetOf(e), e.tool === 'Glob' ? e.pattern : undefined, e.tool === 'Grep' ? e.glob : undefined, e.command]
  if (names.some((v) => typeof v === 'string' && SECRET_FILE.test(v))) return true
  const root = await ownerRoot(realPath, env)
  if (root === undefined) return false
  const isSearch = e.tool === 'Grep' || e.tool === 'Glob'
  if (where !== undefined && (isUnder(where, root) || (isSearch && isUnder(root, where)))) return true
  for (const word of wordsOf(e)) {
    if (await shellWordReachesOwner(realPath, env, root, word)) return true
  }
  return false
}

/**
 * Denies any call that reaches the owner's secrets, a file tool that lands under the state folder or the plugin store, or whose path cannot be placed, and
 * a Bash command that names the managed files or runs the org view (best effort). Rejects when `realPath` throws; the registration's `.catch` denies.
 */
export async function checkToolCall(realPath: RealPath, env: GuardEnv, e: GuardInput): Promise<GuardVerdict> {
  const target = targetOf(e)
  const where = target === undefined ? undefined : await placed(realPath, target)
  if (await reachesOwnerSecrets(realPath, env, e, where)) return { deny: DENY_OWNER_SECRET }
  if (isShellTool(e.tool)) {
    if (typeof e.command !== 'string') return null
    if (runsOrgView(e.command)) return { deny: DENY_ORG_VIEW }
    return SHELL_NAMES.test(e.command) ? { deny: DENY_MANAGED } : null
  }
  if ((GUARDED_READ_TOOLS as readonly string[]).includes(e.tool)) return null
  const roots = await protectedRoots(realPath, env)
  if (where === undefined || roots === undefined) return { deny: DENY_UNPLACED }
  return roots.some((root) => isUnder(where, root)) ? { deny: DENY_MANAGED } : null
}
