#!/usr/bin/env python3
"""Apply one named mutation to a repo-layout copy of the plugin.

Usage: mutate.py <repo-layout-copy-root> <MUTANT-ID>

Each entry in MUTANTS is a list of (path relative to <root>/plugins/rine, old, new). Every
anchor must occur exactly once; anything else means the code moved and the mutation would
change nothing, which is reported as an assertion (exit 3), never a traceback.
"""
import sys

MUTANTS = {
    "M12": [("hooks/lib/supervisor-run.ts",
             "      run.isConnected = true\n",
             "      run.isConnected = true\n      if (phase !== 'live') patch.phase = 'live'\n")],
    "M13": [("hooks/lib/sanitize.ts", ".replace(LONE_ESC, '')", ""),
            ("hooks/lib/sanitize.ts", "\\u000B-\\u001F", "\\u000B-\\u001A\\u001C-\\u001F")],
    "M20": [("hooks/lib/sanitize.ts",
             "\\p{Cf}\\p{Default_Ignorable_Code_Point}",
             "\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF")],
    "M14": [("hooks/lib/router.ts",
             "  if (match.list === 'deny') return intent('filter')\n",
             "  if (match.list === 'allow') return intent('wake')\n"
             "  if (match.list === 'deny') return intent('filter')\n")],
    "M15": [("hooks/lib/lease.ts",
             "    await ports.clock.sleep(SETTLE_MS)\n    isOwned = isOurs(await read())\n",
             "    isOwned = true\n")],
    "M16": [("hooks/lib/router.ts", "verification.status === 'verified' &&", "true &&")],
    "M17": [("hooks/commands/rine.ts",
             "isMutating(command) && e.origin.kind !== 'composer'",
             "isMutating(command) && e.origin.kind !== 'composer' && false")],
    "M17b": [("hooks/register.tsx", ").catch(() => guardFailed())", ")")],
    "M18": [("hooks/lib/delivery-check.ts",
             "isRateAllowed: isWakeAllowed(lease.wakes(), now),", "isRateAllowed: true,")],
    "M19": [("hooks/lib/router.ts", "  if (ctx.isBacklog) return intent('backlog')\n", "")],
    "M21": [("hooks/lib/delivery-check.ts",
             "isListsTrusted: view.lists.isTrusted,", "isListsTrusted: true,")],
    "M22": [("hooks/lib/delivery-wake.ts",
             "    turnComplete: async (event) => {\n      if (event.agentId !== undefined) return\n",
             "    turnComplete: async (event) => {\n")],
    "M23": [("hooks/lib/router.ts",
             "  if (mode === null) return 'mode-unknown'\n"
             "  return mode === BYPASS_MODE ? 'bypass' : null",
             "  return null")],
    "M24": [("hooks/lib/envelope.ts",
             "return head === (await digestHex(body)) ? body : null", "return body")],
    "M25": [("hooks/lib/router.ts",
             "if (checks.list !== 'allow') return 'not-allowlisted'",
             "if (false) return 'not-allowlisted'")],
    "M26": [("hooks/lib/router.ts", " && message.type === WEBHOOK_TYPE", "")],
    "M27": [("hooks/lib/router.ts",
             "(!intent.isWebhook || verification.fromAgentId === checks.ownAgentId)", "true")],
    "M28": [("hooks/lib/supervisor-run.ts",
             "isServerFrame(frame) ? { lastFrameAt: now } : {}", "{ lastFrameAt: now }")],
    "M29": [("hooks/lib/supervisor.ts",
             "checkHealth({ ...health, phase: 'live' }) !== 'ok'", "false")],
    "M30": [("hooks/lib/supervisor.ts",
             "if (checkHealth({ ...health, phase: 'live' }) !== 'ok') markStale(r)",
             "r.liveSince ??= now\n      if (checkHealth({ ...health, phase: 'live' }) !== 'ok') markStale(r)")],
    "M31": [("hooks/lib/backoff.ts", "const since = lastFrameAt ?? connectedAt", "const since = lastFrameAt")],
    "M32": [("hooks/lib/supervisor-run.ts",
             "if (phase !== 'connecting' && phase !== 'stale') {", "if (phase !== 'connecting') {")],
    "M33": [("hooks/lib/supervisor.ts",
             ", '--heartbeat-timeout', String(TIMING.cliSilenceS)", "")],
    "M34": [("hooks/lib/frames.ts", "frame.event !== LIFECYCLE_EVENT", "true")],
    "M35": [("hooks/lib/supervisor.ts", "lastFrameAt: stream.lastFrameAt ?? r.connectedAt", "lastFrameAt: stream.lastFrameAt")],
    "M36": [("hooks/ui/pane.tsx", "await $.ui.close({ id: INBOX_PANE.id })", "void 0")],
    "M37": [("hooks/ui/pane.tsx", "await $.ui.open(INBOX_PANE)", "void 0")],
    "M38": [("hooks/ui/pane.tsx", "{!e.props.isFocused && <Text dimColor>{KEYS_HINT}</Text>}", "{false && <Text dimColor>{KEYS_HINT}</Text>}")],
    "M39": [("hooks/ui/pane.tsx", 'label="Hand to Claude" hotkey="s"', 'label="Hand to Claude" hotkey="h"')],
    "M40": [("hooks/lib/backoff.ts", "cliSilenceS: 80,", "cliSilenceS: 70,")],
}


def main(argv):
    if len(argv) != 3:
        print("usage: mutate.py <repo-layout-copy-root> <MUTANT-ID>", file=sys.stderr)
        return 2
    root, mutant_id = argv[1], argv[2]
    if mutant_id not in MUTANTS:
        print(f"unknown mutant id {mutant_id!r}", file=sys.stderr)
        return 2
    for rel, old, new in MUTANTS[mutant_id]:
        path = f"{root}/plugins/rine/{rel}"
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            print(f"{mutant_id}: {rel}: cannot read: {exc}", file=sys.stderr)
            return 3
        if text.count(old) != 1:
            print(f"{mutant_id}: {rel}: anchor moved; mutation would change nothing "
                  f"({text.count(old)} matches)", file=sys.stderr)
            return 3
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
