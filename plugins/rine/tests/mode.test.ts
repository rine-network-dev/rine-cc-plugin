import { test, expect } from 'claude-code/testing'
import { createKit } from './kit'
import {
  detectMode,
  isBelowFloor,
  parseCliVersion,
  permissionModeFrom,
  resolveRineDir
} from '../hooks/lib/mode'

const interactive = { rineConfigDir: '/cfg', home: undefined, cwd: '/work', isInteractive: true }

test('test_detectMode_headless_makesNoRunAndNoWrite', async () => {
  const kit = createKit()
  kit.fs.files.set('/cfg/credentials.json', '{}')
  const detected = await detectMode(kit.ports, { ...interactive, isInteractive: false })
  expect(detected.mode).toBe('headless')
  expect(kit.runs).toHaveLength(0)
  expect(kit.fs.files.size).toBe(1)
})

test('test_detectMode_headlessWithoutCredentials_isUnregisteredNotConnected', async () => {
  const kit = createKit()
  const detected = await detectMode(kit.ports, { ...interactive, isInteractive: false })
  expect(detected.mode).toBe('unregistered')
  expect(kit.runs).toHaveLength(0)
  expect(kit.fs.files.size).toBe(0)
})

test('test_detectMode_runRejects_isMcpOnly', async () => {
  const kit = createKit()
  kit.setRun(() => new Error('ENOENT'))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.mode).toBe('mcp-only')
  expect(detected.identity.cliVersion).toBeNull()
  expect(detected.identity.isBelowFloor).toBe(false)
})

test('test_detectMode_cliAndCredentials_isReadyWithIdentity', async () => {
  const kit = createKit()
  kit.fs.files.set('/cfg/credentials.json', '{}')
  kit.setRun((argv) =>
    argv[1] === '--version'
      ? { exitCode: 0, stdout: '0.20.0\n', stderr: '' }
      : { exitCode: 0, stdout: '{"agent":"alice@acme.rine.network","agent_id":"a-1"}', stderr: '' }
  )
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.mode).toBe('ready')
  expect(detected.identity.handle).toBe('alice@acme.rine.network')
  expect(detected.identity.agentId).toBe('a-1')
  expect(detected.identity.cliVersion).toBe('0.20.0')
  expect(detected.identity.isBelowFloor).toBe(false)
  expect(detected.identity.isStateWritable).toBe(true)
})

test('test_detectMode_cliWithoutCredentials_isUnregistered', async () => {
  const kit = createKit()
  kit.setRun(() => ({ exitCode: 0, stdout: '0.20.0\n', stderr: '' }))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.mode).toBe('unregistered')
  expect(detected.identity.handle).toBeNull()
  expect(kit.runs).toHaveLength(1)
})

test('test_detectMode_whoamiLoggedOut_keepsReadyWithNullAgentId', async () => {
  const kit = createKit()
  kit.fs.files.set('/cfg/credentials.json', '{}')
  kit.setRun((argv) =>
    argv[1] === '--version'
      ? { exitCode: 0, stdout: '0.20.0\n', stderr: '' }
      : { exitCode: 0, stdout: '{"logged_in":false}', stderr: '' }
  )
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.mode).toBe('ready')
  expect(detected.identity.agentId).toBeNull()
  expect(detected.identity.handle).toBeNull()
})

test('test_detectMode_whoamiRejects_keepsReadyWithNullAgentId', async () => {
  const kit = createKit()
  kit.fs.files.set('/cfg/credentials.json', '{}')
  kit.setRun((argv) =>
    argv[1] === '--version'
      ? { exitCode: 0, stdout: '0.20.0\n', stderr: '' }
      : new Error('boom')
  )
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.mode).toBe('ready')
  expect(detected.identity.agentId).toBeNull()
})

test('test_detectMode_probeWriteFails_marksStateReadOnly', async () => {
  const kit = createKit()
  kit.fs.isWriteFailing = true
  kit.setRun(() => ({ exitCode: 0, stdout: '0.20.0\n', stderr: '' }))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.identity.isStateWritable).toBe(false)
})

test('test_detectMode_passesResolvedDirInEveryRunEnv', async () => {
  const kit = createKit()
  kit.fs.files.set('/cfg/credentials.json', '{}')
  const envs: (Record<string, string> | undefined)[] = []
  const inner = kit.ports.run
  kit.ports.run = async (argv, init) => {
    envs.push(init?.env)
    return inner(argv, init)
  }
  kit.setRun((argv) =>
    argv[1] === '--version'
      ? { exitCode: 0, stdout: '0.20.0\n', stderr: '' }
      : { exitCode: 0, stdout: '{"agent_id":"a-1"}', stderr: '' }
  )
  await detectMode(kit.ports, interactive)
  expect(envs).toHaveLength(2)
  expect(envs[0]?.RINE_CONFIG_DIR).toBe('/cfg')
  expect(envs[1]?.RINE_CONFIG_DIR).toBe('/cfg')
})

test('test_resolveRineDir_envSetWithoutCreds_winsUnconditionally', async () => {
  const kit = createKit()
  const dir = await resolveRineDir(kit.ports, { ...interactive, rineConfigDir: '/explicit' })
  expect(dir).toBe('/explicit')
})

test('test_resolveRineDir_envEmptyString_isIgnored', async () => {
  const kit = createKit()
  kit.fs.files.set('/home/u/.config/rine/credentials.json', '{}')
  const dir = await resolveRineDir(kit.ports, { ...interactive, rineConfigDir: '', home: '/home/u' })
  expect(dir).toBe('/home/u/.config/rine')
})

test('test_resolveRineDir_homeConfigWithCreds_beatsCwd', async () => {
  const kit = createKit()
  kit.fs.files.set('/home/u/.config/rine/credentials.json', '{}')
  kit.fs.files.set('/work/.rine/credentials.json', '{}')
  const dir = await resolveRineDir(kit.ports, { ...interactive, rineConfigDir: undefined, home: '/home/u' })
  expect(dir).toBe('/home/u/.config/rine')
})

test('test_resolveRineDir_cwdRineWithCreds_whenHomeHasNone', async () => {
  const kit = createKit()
  kit.fs.files.set('/work/.rine/credentials.json', '{}')
  const dir = await resolveRineDir(kit.ports, { ...interactive, rineConfigDir: undefined, home: '/home/u' })
  expect(dir).toBe('/work/.rine')
})

test('test_resolveRineDir_noneHaveCreds_fallsBackToHomeConfig', async () => {
  const kit = createKit()
  const dir = await resolveRineDir(kit.ports, { ...interactive, rineConfigDir: undefined, home: '/home/u' })
  expect(dir).toBe('/home/u/.config/rine')
})

test('test_parseCliVersion', async () => {
  expect(parseCliVersion('0.20.0\n')).toBe('0.20.0')
  expect(parseCliVersion('0.21.0-rc.1')).toBe('0.21.0')
  expect(parseCliVersion('garbage')).toBeNull()
  expect(parseCliVersion('')).toBeNull()
  expect(parseCliVersion('1.2')).toBeNull()
})

test('test_isBelowFloor', async () => {
  expect(isBelowFloor('0.19.0')).toBe(true)
  expect(isBelowFloor('0.19.99')).toBe(true)
  expect(isBelowFloor('0.20.0')).toBe(false)
  expect(isBelowFloor('0.20.1')).toBe(false)
  expect(isBelowFloor('1.0.0')).toBe(false)
  expect(isBelowFloor('0.100.0')).toBe(false)
  expect(isBelowFloor(null)).toBe(false)
})

test('test_detectMode_cliBelowFloor_flagsIsBelowFloor', async () => {
  const kit = createKit()
  kit.setRun(() => ({ exitCode: 0, stdout: '0.19.0', stderr: '' }))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.identity.isBelowFloor).toBe(true)
})

test('test_detectMode_versionNonZeroExit_cliVersionNull_notBelowFloor', async () => {
  const kit = createKit()
  kit.setRun(() => ({ exitCode: 1, stdout: '', stderr: 'nope' }))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.identity.cliVersion).toBeNull()
  expect(detected.identity.isBelowFloor).toBe(false)
})

test('test_detectMode_versionUnparseable_cliVersionNull_notBelowFloor', async () => {
  const kit = createKit()
  kit.setRun(() => ({ exitCode: 0, stdout: 'garbage', stderr: '' }))
  const detected = await detectMode(kit.ports, interactive)
  expect(detected.identity.cliVersion).toBeNull()
  expect(detected.identity.isBelowFloor).toBe(false)
})

test('test_permissionModeFrom_mainLoopEvent_recorded', async () => {
  expect(permissionModeFrom({ permission_mode: 'plan' }, null)).toBe('plan')
})

test('test_permissionModeFrom_subagentEvent_ignored', async () => {
  expect(permissionModeFrom({ permission_mode: 'plan', agent_id: 'sub-1' }, 'acceptEdits')).toBe('acceptEdits')
})

test('test_permissionModeFrom_missingMode_keepsCurrent', async () => {
  expect(permissionModeFrom({}, 'acceptEdits')).toBe('acceptEdits')
})

test('test_permissionModeFrom_startsNull', async () => {
  expect(permissionModeFrom({}, null)).toBeNull()
})
