/** A shell command is cut into segments at these, so `cd x && rine tui`, `a | rine tui --feed` and `rine tui>out` are each seen on their own. */
const SEGMENT_BREAK = new Set(';&|\n()`<>')
/** The ways the rine CLI is named on a command line: the `rine` binary (or its `.js`, `.cmd`, `.exe` form), the built `dist/main.js`, or the npm package under `npx`. */
const CLI_WORD = /^(?:@rine-network\/cli(?:@\S*)?|(?:.*\/)?rine(?:\.js|\.cmd|\.exe)?|(?:.*\/)?dist\/main\.js)$/
/** The program's own options that take a value; any other leading option stands alone. */
const OPTIONS_WITH_VALUE = new Set(['--profile', '--as'])
/** Options after which the program prints text and exits, so no subcommand runs. */
const OPTIONS_THAT_EXIT = new Set(['--help', '-h', '--version', '-V'])
/** Commands that run the words after them as another command, so the CLI word may follow one without being the first word. */
const LAUNCHERS = new Set(['node', 'npx', 'sudo', 'env', 'exec', 'time', 'nohup', 'command'])
/** Shells, which run a string argument as a whole command line of its own. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'eval'])
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const HEREDOC = /<<(-?)\s*(?:'([^']*)'|"([^"]*)"|(\\?)([\w.-]+))/y

/** A here-document named on a command line: its body runs from the next line to the delimiter line, and is data unless the delimiter is unquoted. */
type Heredoc = { delimiter: string; isTabbed: boolean; isLiteral: boolean }

/** The here-document operator at `at` (`<<EOF`, `<<-'EOF'`), with its length; not a here-string (`<<<`) and not a shift inside `(( ))`, which the caller rules out. */
function heredocAt(text: string, at: number): { heredoc: Heredoc; length: number } | null {
  if (text[at] !== '<' || text[at + 1] !== '<' || text[at + 2] === '<' || text[at - 1] === '<') return null
  HEREDOC.lastIndex = at
  const found = HEREDOC.exec(text)
  if (found === null) return null
  const [whole, dash, single, double, backslash, bare] = found
  return { heredoc: { delimiter: single ?? double ?? bare ?? '', isTabbed: dash === '-', isLiteral: single !== undefined || double !== undefined || backslash === '\\' }, length: whole.length }
}

const isLineStart = (text: string, at: number): boolean => at === 0 || text[at - 1] === '\n'

/** The text of a quoted string or a here-document body, from `from` to where `ends` holds: `$( )` and backticks inside it run as commands, and their segments go to `out`. */
function scanText(text: string, from: number, out: string[][], ends: (at: number) => boolean, isLiteral = false): [string, number] {
  let value = ''
  let at = from
  while (at < text.length && !ends(at)) {
    const char = text[at] as string
    if (isLiteral) value += char
    else if (char === '\\' && at + 1 < text.length) value += text[++at]
    else if (char === '$' && text[at + 1] === '(') at = scan(text, at + 2, ')', out) - 1
    else if (char === '`') at = scan(text, at + 1, '`', out) - 1
    else value += char
    at++
  }
  return [value, at]
}

/** Where a here-document body ends: past its delimiter line, or the end of the text. */
function skipBody(text: string, from: number, doc: Heredoc, out: string[][]): number {
  const atDelimiter = (at: number): boolean => {
    if (!isLineStart(text, at)) return false
    const eol = text.indexOf('\n', at)
    const line = text.slice(at, eol < 0 ? text.length : eol)
    return (doc.isTabbed ? line.replace(/^\t+/, '') : line) === doc.delimiter
  }
  const [, at] = scanText(text, from, out, atDelimiter, doc.isLiteral)
  const eol = text.indexOf('\n', at)
  return eol < 0 ? text.length : eol + 1
}

/**
 * Cuts a command into segments of words, as a shell reads it, until `close` (the end for `''`): quotes group a word and hide `;`, `|` and newlines
 * inside it, a backslash escapes one character, and a here-document body is data. Substitutions inside quotes are commands and become segments too.
 * Returns where reading stopped.
 */
function scan(text: string, from: number, close: string, out: string[][]): number {
  let words: string[] = []
  let word = ''
  let isStarted = false
  let depth = 0
  const pending: Heredoc[] = []
  const endWord = (): void => {
    if (isStarted) words.push(word)
    word = ''
    isStarted = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) out.push(words)
    words = []
  }
  let at = from
  while (at < text.length) {
    const char = text[at] as string
    if (char === close && depth === 0) break
    if (char === '\\' && at + 1 < text.length) {
      word += text[at + 1]
      isStarted = true
      at += 2
    } else if (char === "'") {
      const end = text.indexOf("'", at + 1)
      word += text.slice(at + 1, end < 0 ? text.length : end)
      isStarted = true
      at = end < 0 ? text.length : end + 1
    } else if (char === '"') {
      const [value, end] = scanText(text, at + 1, out, (here) => text[here] === '"')
      word += value
      isStarted = true
      at = end + 1
    } else if (/\s/.test(char) && char !== '\n') {
      endWord()
      at++
    } else if (char === '#' && !isStarted) {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end
    } else if (SEGMENT_BREAK.has(char)) {
      endSegment()
      if (char === '(') depth++
      else if (char === ')' && depth > 0) depth--
      const doc = depth < 2 ? heredocAt(text, at) : null
      if (doc !== null) {
        pending.push(doc.heredoc)
        at += doc.length
      } else at++
      if (char === '\n') for (let next = pending.shift(); next !== undefined; next = pending.shift()) at = skipBody(text, at, next, out)
    } else {
      word += char
      isStarted = true
      at++
    }
  }
  endSegment()
  return at + 1
}

/** A command segment split into the words a shell would hand over: quotes group a word, backslashes escape one character, and neither is kept. */
function commandSegments(command: string): string[][] {
  const segments: string[][] = []
  scan(command.replace(/\\\r?\n/g, ' '), 0, '', segments)
  return segments
}

/** Whether the words after a CLI word reach the `tui` subcommand past the program's own options. */
function reachesTui(words: readonly string[], from: number): boolean {
  let at = from
  while (words[at]?.startsWith('-')) {
    const option = words[at] as string
    if (OPTIONS_THAT_EXIT.has(option)) return false
    at += OPTIONS_WITH_VALUE.has(option) ? 2 : 1
  }
  return words[at] === 'tui'
}

/** Whether one command segment runs the CLI's `tui`: the CLI word leads it, after assignments and launchers, or sits in a string a shell is told to run. */
function callsTui(words: readonly string[]): boolean {
  let at = 0
  for (;;) {
    const word = words[at]
    if (word === undefined) return false
    if (ASSIGNMENT.test(word)) at++
    else if (LAUNCHERS.has(word)) {
      at++
      while (words[at]?.startsWith('-')) at++
    } else break
  }
  const head = words[at] as string
  if (SHELLS.has(head)) return words.slice(at + 1).some(runsOrgView)
  return CLI_WORD.test(head) && reachesTui(words, at + 1)
}

/**
 * Whether a shell command line runs `rine tui` (`--feed` included) as a command: first in a segment, or behind assignments, `env`, `sudo`, `exec`,
 * `time`, `npx`, `node <path>/main.js` or a path to the binary, inside a chain, a pipe, a redirect, `$( )`, backticks or a `sh -c` string. A sentence that
 * only mentions the words (a commit message or its here-document, a grep pattern, an echo) passes.
 *
 * This is a tripwire on the command's text, not a control: it keeps a model from running the org view by accident or by the plain spelling. A script
 * file that holds the command, a variable or an alias that names it, a program that builds the name at run time, and an interpreter handed the argument
 * list (`python -c "subprocess.run(['rine','tui'])"`, `execFileSync`) all get past it, as does a wrapper it does not list, such as `xargs` or `env -u`.
 */
export function runsOrgView(command: string): boolean {
  return commandSegments(command).some(callsTui)
}
