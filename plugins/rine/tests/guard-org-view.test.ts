import { test, expect } from 'claude-code/testing'
import { checkToolCall, DENY_ORG_VIEW, type GuardEnv, type RealPath } from '../hooks/lib/guard'

const ENV: GuardEnv = { rineDirs: ['/home/u/proj/.rine'], claudeConfigDir: '/home/u/.claude', home: '/home/u', ownerDir: undefined }
const real: RealPath = async (path) => path
const verdictOf = (command: string) => checkToolCall(real, ENV, { tool: 'Bash', command })

/** Command lines that run `rine tui`, each spelled a way a model or a person might type it. */
const RUNS_THE_ORG_VIEW = [
  'rine tui',
  'rine tui --feed',
  'rine tui --feed --once --before abc',
  'rine --profile work tui --feed',
  'rine --as bob@x.rine.network tui',
  'rine --json tui',
  '/usr/local/bin/rine tui',
  './rine tui',
  '../bin/rine tui --feed',
  'npx @rine-network/cli tui',
  'npx -y @rine-network/cli@0.22.0 tui --feed',
  'node dist/main.js tui --feed',
  'node /srv/rine/rine-cli/dist/main.js --profile x tui',
  'node ./node_modules/.bin/rine.js tui',
  'cd /tmp && rine tui --feed | head -n 5',
  'false || rine tui',
  'echo start; rine tui --feed',
  'echo a\nrine tui',
  'echo a | rine tui --feed',
  'FOO=1 rine tui --feed',
  'FOO=1 BAR=2 rine tui',
  'env FOO=1 rine tui',
  'sudo rine tui',
  'sudo -E env FOO=1 rine tui',
  'exec rine tui',
  'time node dist/main.js tui',
  'nohup rine tui --feed',
  'bash -c "rine tui --feed"',
  "sh -c 'cd /tmp; rine tui'",
  "eval 'rine tui'",
  'x=$(rine tui --feed)',
  'echo "$(rine tui --feed)"',
  'echo `rine tui --feed`',
  '(rine tui --feed)',
  'rine "tui" --feed',
  "rine 'tui'",
  'rine \\\n  tui --feed',
  'rine tui>out',
  'rine tui --feed 2>&1 >/dev/null',
  'rine --profile "a b" tui --feed',
  'cat <<EOF\nhello\nEOF\nrine tui',
  'rine.cmd tui',
  'C:/tools/rine.exe tui --feed'
]

/** Command lines that mention the words or run another rine command; none of them runs the org view. */
const DOES_NOT_RUN_THE_ORG_VIEW = [
  'rine inbox --json',
  'rine --profile work stream',
  'rine send --to bob@x.rine.network tui',
  'rine tuition',
  'rine --profile tui inbox',
  'npx @rine-network/cli whoami',
  'node dist/main.js org status',
  'git status',
  'git commit -m "docs: rine tui"',
  "git commit -m 'fix: rine tui\n\nrine tui --feed is read-only; a; b | c'",
  'git commit -m "$(cat <<\'EOF\'\nfeat: rine tui\n\nrine tui --feed\nEOF\n)"',
  'echo rine tui',
  'echo "ran rine tui; done"',
  "grep 'rine tui' file",
  'grep -r "rine tui" docs | head',
  'man rine tui',
  'which rine tui',
  'rine --help tui',
  'rine --version tui',
  'rine --profile "a tui" inbox',
  'ls tui',
  'cat rine/tui.ts',
  '# rine tui\nls',
  'echo "$(date) rine tui"',
  "sh -c 'echo rine tui'"
]

test('test_checkToolCall_bashSpellingsOfTheOrgView_areDenied', async () => {
  for (const command of RUNS_THE_ORG_VIEW) expect(await verdictOf(command), command).toEqual({ deny: DENY_ORG_VIEW })
})

test('test_checkToolCall_bashLinesThatOnlyMentionTheOrgView_pass', async () => {
  for (const command of DOES_NOT_RUN_THE_ORG_VIEW) expect(await verdictOf(command), command).toBeNull()
})
