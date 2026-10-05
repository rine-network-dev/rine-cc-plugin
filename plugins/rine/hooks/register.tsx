import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { registerRine, RINE_COMMAND } from './commands/rine'
import { guardFailed, GUARDED_FILE_TOOLS, GUARDED_SHELL_TOOL } from './lib/guard'
import type { Backend } from './lib/ports'
import { TOOL_PATTERN } from './lib/refs'
import type { Host, Published, Recalled } from './runtime/host'
import { createRuntime, type Runtime } from './runtime/runtime'
import { delegateUi } from './runtime/ui-env'
import { registerBand } from './ui/band'
import { registerPane } from './ui/pane'
import { registerToolCards } from './ui/tool-cards'

const modeRef = { plugin: 'rine', key: 'mode' } as const
const identityRef = { plugin: 'rine', key: 'identity' } as const
const streamRef = { plugin: 'rine', key: 'stream' } as const
const entriesRef = { plugin: 'rine', key: 'entries' } as const
const prefsRef = { plugin: 'rine', key: 'prefs' } as const
const listsRef = { plugin: 'rine', key: 'lists' } as const
const digestRef = { plugin: 'rine', key: 'listsDigest' } as const
const trustedRef = { plugin: 'rine', key: 'isListsTrusted' } as const
const ownerRef = { plugin: 'rine', key: 'isOwner' } as const
const legacyRef = { plugin: 'rine', key: 'isLegacyPaused' } as const
const busyRef = { plugin: 'rine', key: 'isBusy' } as const
const pendingRef = { plugin: 'rine', key: 'pendingWake' } as const
const cooldownRef = { plugin: 'rine', key: 'wakeCooldownUntil' } as const
const permissionRef = { plugin: 'rine', key: 'permissionMode' } as const
const sinceRef = { plugin: 'rine', key: 'mirrorSince' } as const
const nonceRef = { plugin: 'rine', key: 'leaseNonce' } as const
const previewRef = { plugin: 'rine', key: 'preview' } as const

const GUARDED = new RegExp(`^(${[...GUARDED_FILE_TOOLS, GUARDED_SHELL_TOOL].join('|')})$`)

/** `messageCount` reads the API form, the one a `turn.step`'s `messageCount` counts; the row form can run ahead of it. */
export function backendFor($: EngineInterface): Backend {
  return {
    now: () => $.clock.now(),
    sleep: (ms) => $.clock.sleep(ms),
    exists: (path) => $.fs.exists(path),
    readText: (path) => $.fs.read(path),
    writeText: (path, text) => $.fs.write(path, text),
    run: async (argv, init) => {
      const r = await $.process.run(argv, init)
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
    append: async (type, text) => {
      const r = await $.session.append({ message: { type, content: [{ type: 'text', text }] } })
      return { isDenied: r.deny !== undefined }
    },
    messageCount: async () => (await $.session.messages({ as: 'api' })).length,
    submit: async (text) => {
      const result = await $.prompt.submit({ text })
      return result.drop !== undefined ? { drop: result.drop } : { entered: result.text }
    },
    toast: (text) => $.ui.toast(text, { timeoutMs: 6000 }),
    log: (text) => $.ui.log(text, { to: 'debug' })
  }
}

/** Writes each key a patch names into `$.state`, where the drawings read it. */
async function publishState($: EngineInterface, patch: Published): Promise<void> {
  const { mode, identity, stream, entries, prefs, lists, listsDigest, isListsTrusted, isOwner, isLegacyPaused, isBusy } = patch
  const { pendingWake, wakeCooldownUntil, permissionMode, mirrorSince, leaseNonce } = patch
  const jobs: Promise<unknown>[] = []
  if (mode !== undefined) jobs.push(update($, modeRef, () => mode))
  if (identity !== undefined) jobs.push(update($, identityRef, () => identity))
  if (stream !== undefined) jobs.push(update($, streamRef, () => stream))
  if (entries !== undefined) jobs.push(update($, entriesRef, () => entries))
  if (prefs !== undefined) jobs.push(update($, prefsRef, () => prefs))
  if (lists !== undefined) jobs.push(update($, listsRef, () => lists))
  if (listsDigest !== undefined) jobs.push(update($, digestRef, () => listsDigest))
  if (isListsTrusted !== undefined) jobs.push(update($, trustedRef, () => isListsTrusted))
  if (isOwner !== undefined) jobs.push(update($, ownerRef, () => isOwner))
  if (isLegacyPaused !== undefined) jobs.push(update($, legacyRef, () => isLegacyPaused))
  if (isBusy !== undefined) jobs.push(update($, busyRef, () => isBusy))
  if (pendingWake !== undefined) jobs.push(update($, pendingRef, () => pendingWake))
  if (wakeCooldownUntil !== undefined) jobs.push(update($, cooldownRef, () => wakeCooldownUntil))
  if (permissionMode !== undefined) jobs.push(update($, permissionRef, () => permissionMode))
  if (mirrorSince !== undefined) jobs.push(update($, sinceRef, () => mirrorSince))
  if (leaseNonce !== undefined) jobs.push(update($, nonceRef, () => leaseNonce))
  await Promise.all(jobs)
}

async function recallState($: EngineInterface): Promise<Recalled> {
  return {
    entries: await read($, entriesRef),
    mirrorSince: await read($, sinceRef),
    leaseNonce: await read($, nonceRef),
    permissionMode: await read($, permissionRef)
  }
}

function hostFor($: EngineInterface): Host {
  return {
    backend: backendFor($),
    env: (name) =>
      name === 'rineConfigDir' ? $.env.get('RINE_CONFIG_DIR') : name === 'home' ? $.env.get('HOME') : $.env.get('CLAUDE_CONFIG_DIR'),
    publish: (patch) => publishState($, patch),
    recall: () => recallState($),
    setPreview: async (id, preview) => {
      await update($, { ...previewRef, id }, () => preview)
    },
    realPath: async (path) => (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath,
    loadDigests: async (key) => {
      const kept = await $.store.get(key)
      return Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string') : []
    },
    saveDigests: (key, digests) => $.store.set(key, [...digests]),
    spawn: (argv, env) => {
      const child = $.process.spawn({ argv, env })
      return { next: () => child.next(), return: () => child.return({ code: null, signal: 'SIGTERM' }) }
    },
    every: (ms, fn) => {
      const timer = $.clock.every(ms, fn)
      return () => timer.cancel()
    },
    after: (ms, fn) => {
      const timer = $.clock.after(ms, fn)
      return () => timer.cancel()
    },
    status: (text) => $.ui.status(text),
    sessionId: () => $.session.id(),
    cwd: () => $.session.cwd()
  }
}

let runtime: Runtime | null = null

/** The module's one runtime, built by whichever event fires first. */
const runtimeOf = ($: EngineInterface): Runtime => (runtime ??= createRuntime(hostFor($)))

export const register: Register = (on) => {
  const ui = delegateUi(() => runtime?.ui ?? null)
  registerBand(on, ui)
  registerPane(on, ui)
  registerToolCards(on)
  registerRine(on, ui)

  on('session.start', async ($, e, next) => {
    await $.command.register(RINE_COMMAND)
    runtimeOf($).start({ cwd: e.cwd, isInteractive: e.isInteractive })
    return next(e)
  })
  on('session.end', async (_$, e, next) => {
    await runtime?.end(e.reason).catch(() => undefined)
    return next(e)
  })
  on('command.run', async ($, e, next) => {
    runtimeOf($).ensure()
    return next(e)
  })
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = await runtimeOf($).compose()
    return text === null ? composed : { sections: [...composed.sections, { id: 'rine:context', text, scope: 'session' }] }
  })
  on('turn.start', async ($, e, next) => {
    runtimeOf($).ensure()
    await runtimeOf($).turnStart(e).catch(() => undefined)
    return next(e)
  })
  on('turn.step', async function* ($, e, next) {
    runtimeOf($).ensure()
    runtimeOf($).turnStep(e)
    return yield* next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void runtimeOf($).turnComplete(e).catch(() => undefined)
    return done
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    runtimeOf($).prompt(e)
    return next(e)
  })
  on('tool.call', { tool: GUARDED }, async ($, e, next) => (await runtimeOf($).guard(e)) ?? next(e)).catch(() => guardFailed())
  on('tool.call', { tool: TOOL_PATTERN }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && !ran.isError) {
      void runtimeOf($).readMarked(e.tool, e).catch(() => undefined)
    }
    return ran
  })
}
