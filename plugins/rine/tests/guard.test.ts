import { test, expect } from 'claude-code/testing'
import {
  checkToolCall,
  DENY_GUARD_FAILED,
  DENY_MANAGED,
  DENY_ORG_VIEW,
  DENY_OWNER_SECRET,
  DENY_UNPLACED,
  guardFailed,
  placed,
  type GuardEnv,
  type RealPath
} from '../hooks/lib/guard'

const ENV: GuardEnv = { rineDirs: ['/home/u/proj/.rine'], claudeConfigDir: '/home/u/.claude', home: '/home/u', ownerDir: undefined }
const EXISTING = ['/', '/home', '/home/u', '/home/u/proj', '/home/u/proj/.rine', '/home/u/proj/.rine/state/cc',
  '/home/u/proj/.rine/state/cc/lists.json', '/home/u/.claude', '/home/u/.claude/plugins/store', '/home/u/work']

/** An in-memory `realPath`: existing paths map to themselves unless `links` redirects them. */
function fakeReal(links: Record<string, string> = {}, existing: string[] = EXISTING): RealPath {
  return async (path) => {
    if (path in links) return links[path]
    return existing.includes(path) ? path : undefined
  }
}

const write = (file_path: unknown, tool = 'Write') => ({ tool, file_path })

test('test_checkToolCall_writeIntoExistingStateFile_isDenied', async () => {
  const verdict = await checkToolCall(fakeReal(), ENV, write('/home/u/proj/.rine/state/cc/lists.json'))
  expect(verdict).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_newFileUnderStateDir_isDenied', async () => {
  const verdict = await checkToolCall(fakeReal(), ENV, write('/home/u/proj/.rine/state/cc/new/deep.json'))
  expect(verdict).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_pluginStore_isDeniedForConfigDirAndHomeFallback', async () => {
  const path = '/home/u/.claude/plugins/store/rine/data.json'
  expect(await checkToolCall(fakeReal(), ENV, write(path, 'Edit'))).toEqual({ deny: DENY_MANAGED })
  const fallback = { ...ENV, claudeConfigDir: undefined }
  expect(await checkToolCall(fakeReal(), fallback, write(path, 'MultiEdit'))).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_symlinkIntoStateDir_isDenied', async () => {
  const real = fakeReal({ '/home/u/work/link.json': '/home/u/proj/.rine/state/cc/lists.json' }, [...EXISTING, '/home/u/work/link.json'])
  expect(await checkToolCall(real, ENV, write('/home/u/work/link.json'))).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_symlinkedParentIntoStateDir_isDenied', async () => {
  const real = fakeReal({ '/home/u/work': '/home/u/proj/.rine/state/cc' })
  expect(await checkToolCall(real, ENV, write('/home/u/work/new.json'))).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_unplaceableSpellings_areDenied', async () => {
  for (const path of ['~/x', '//host/share/f', 'C:x', '/home/u/work/', '/home/u/work/..', '']) {
    expect(await checkToolCall(fakeReal(), ENV, write(path))).toEqual({ deny: DENY_UNPLACED })
  }
})

test('test_checkToolCall_missingOrNonStringPath_isDenied', async () => {
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Write' })).toEqual({ deny: DENY_UNPLACED })
  expect(await checkToolCall(fakeReal(), ENV, write(7))).toEqual({ deny: DENY_UNPLACED })
})

test('test_checkToolCall_outsidePath_passes_includingNewNestedDirs', async () => {
  expect(await checkToolCall(fakeReal(), ENV, write('/home/u/work/a.ts'))).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, write('/home/u/work/new/dir/b.ts'))).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, write('/home/u/proj/.rine/state/other.json'))).toBeNull()
})

test('test_checkToolCall_notebookEdit_readsNotebookPath', async () => {
  const input = { tool: 'NotebookEdit', notebook_path: '/home/u/proj/.rine/state/cc/x.ipynb' }
  expect(await checkToolCall(fakeReal(), ENV, input)).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_bashNamingManagedFiles_isDenied', async () => {
  const deny = { deny: DENY_MANAGED }
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'echo {} > .rine/state/cc/lists.json' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'cat lists.json' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'ls ~/.claude/plugins/store' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'ls -la' })).toBeNull()
})

test('test_checkToolCall_unplaceableStateDir_isDenied', async () => {
  const real: RealPath = async (path) => (path.includes('.rine') ? undefined : path === '/' ? '/' : '/home/u/work')
  const input = write('/home/u/work/a.ts')
  expect(await checkToolCall(real, { ...ENV, rineDirs: ['~/.rine'], ownerDir: '~/owner' }, input)).toEqual({ deny: DENY_UNPLACED })
})

test('test_checkToolCall_realPathThrows_rejects_andGuardFailedDenies', async () => {
  const boom: RealPath = async () => {
    throw new Error('stat failed')
  }
  await expect(checkToolCall(boom, ENV, write('/home/u/work/a.ts'))).rejects.toThrow()
  expect(guardFailed()).toEqual({ deny: DENY_GUARD_FAILED })
})

test('test_placed_existingFile_isItsRealPath_andNewTailIsAppended', async () => {
  expect(await placed(fakeReal(), '/home/u/work')).toBe('/home/u/work')
  expect(await placed(fakeReal(), '/home/u/work/a/b.ts')).toBe('/home/u/work/a/b.ts')
})

test('test_checkToolCall_stateDirOfTheSessionAfterACd_isStillDenied', async () => {
  const afterCd = { ...ENV, rineDirs: ['/home/u/work/.rine', '/home/u/proj/.rine'] }
  const real = fakeReal({}, [...EXISTING, '/home/u/work/.rine'])
  const verdict = await checkToolCall(real, afterCd, write('/home/u/proj/.rine/state/cc/prefs.json'))
  expect(verdict).toEqual({ deny: DENY_MANAGED })
  expect(await checkToolCall(real, afterCd, write('/home/u/work/.rine/state/cc/prefs.json'))).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_caseAliasOfTheStateDir_isDenied', async () => {
  const real = fakeReal({ '/home/u/proj/.rine/State/CC/prefs.json': '/home/u/proj/.rine/State/CC/prefs.json' })
  const verdict = await checkToolCall(real, ENV, write('/home/u/proj/.rine/State/CC/prefs.json'))
  expect(verdict).toEqual({ deny: DENY_MANAGED })
})

test('test_checkToolCall_readOfOwnerSecrets_isDeniedWhereverTheOwnerDirLives', async () => {
  const deny = { deny: DENY_OWNER_SECRET }
  for (const file_path of ['/srv/owner/root.key', '/home/u/.config/rine-owner/recovery-phrase.txt', '/x/owner/branch/main/sign.key']) {
    expect(await checkToolCall(fakeReal(), ENV, { tool: 'Read', file_path })).toEqual(deny)
  }
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Grep', path: '/srv/owner', glob: 'recovery-phrase.txt' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Glob', pattern: '/srv/owner/**/root.key' })).toEqual(deny)
})

test('test_checkToolCall_writeAndShellNamingOwnerSecrets_isDenied', async () => {
  const deny = { deny: DENY_OWNER_SECRET }
  expect(await checkToolCall(fakeReal(), ENV, write('/home/u/work/recovery-phrase.txt', 'Edit'))).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'cat root.key' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'ls ~/.config/rine-owner/' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'cat owner/branch/main/sign.key' })).toEqual(deny)
})

test('test_checkToolCall_pathInsideTheOwnerDir_isDenied_whateverItIsCalled', async () => {
  const deny = { deny: DENY_OWNER_SECRET }
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Read', file_path: '/home/u/.config/rine-owner/token_cache.json' })).toEqual(deny)
  const custom = { ...ENV, ownerDir: '/srv/keys' }
  expect(await checkToolCall(fakeReal(), custom, { tool: 'Read', file_path: '/srv/keys/profiles.json' })).toEqual(deny)
  const link = fakeReal({ '/home/u/work/via': '/srv/keys' }, [...EXISTING, '/srv/keys', '/home/u/work/via'])
  expect(await checkToolCall(link, custom, { tool: 'Read', file_path: '/home/u/work/via/profiles.json' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Read', file_path: '/x/delegate/branch/b/read.key' })).toEqual(deny)
})

test('test_checkToolCall_searchFromAnAncestorOfTheOwnerDir_isDenied', async () => {
  const deny = { deny: DENY_OWNER_SECRET }
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Grep', path: '/home/u/.config', pattern: '.' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Glob', path: '/home/u', pattern: '**/*' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Grep', path: '/home/u/work', pattern: 'root.key' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Glob', path: '/home/u/work', pattern: '**/*.ts' })).toBeNull()
})

test('test_checkToolCall_shellWordsReachingTheOwnerDir_areDenied', async () => {
  const deny = { deny: DENY_OWNER_SECRET }
  const custom = { ...ENV, ownerDir: '/srv/keys' }
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'cat ~/.config/rine-o*/root.k*' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'tar c $HOME/.config/rine-owner/*' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), custom, { tool: 'Bash', command: 'cat "$RINE_OWNER_DIR"/token_cache.json' })).toEqual(deny)
  expect(await checkToolCall(fakeReal(), custom, { tool: 'Bash', command: 'ls /srv/keys' })).toEqual(deny)
})

test('test_checkToolCall_ordinaryReads_andLookalikeNames_pass', async () => {
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Read', file_path: '~/anything/at/all.ts' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Read', file_path: '/home/u/work/myroot.key.md' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'git status' })).toBeNull()
})

test('test_checkToolCall_searchingForTheOwnerFolderName_isNotDenied', async () => {
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'git log --oneline -- docs/rine-owner-dir.md' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Bash', command: 'ls ~/.config' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, { tool: 'Grep', path: '/home/u/work/docs', pattern: 'recovery-phrase.txt' })).toBeNull()
  expect(await checkToolCall(fakeReal(), ENV, write('/home/u/work/docs/rine-owner-dir.md', 'Edit'))).toBeNull()
})

test('test_checkToolCall_everyShellRunningTool_isHeldToTheOrgViewAndSecretChecks', async () => {
  for (const tool of ['Bash', 'Monitor', 'PowerShell']) {
    expect(await checkToolCall(fakeReal(), ENV, { tool, command: 'rine tui --feed' }), tool).toEqual({ deny: DENY_ORG_VIEW })
    expect(await checkToolCall(fakeReal(), ENV, { tool, command: 'cat /home/u/proj/.rine/state/cc/lists.json' }), tool).toEqual({ deny: DENY_MANAGED })
    expect(await checkToolCall(fakeReal(), ENV, { tool, command: 'cat /srv/owner/root.key' }), tool).toEqual({ deny: DENY_OWNER_SECRET })
    expect(await checkToolCall(fakeReal(), ENV, { tool, command: 'cat branch/main/read.key' }), tool).toEqual({ deny: DENY_OWNER_SECRET })
    expect(await checkToolCall(fakeReal(), ENV, { tool, command: 'git status' }), tool).toBeNull()
  }
})
