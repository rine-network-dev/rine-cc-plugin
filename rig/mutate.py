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
    "M38": [("hooks/ui/pane-hints.tsx",
             "!isFocused && hintLine(ui, 'hint', KEYS_HINT, columns)",
             "false && hintLine(ui, 'hint', KEYS_HINT, columns)")],
    "M39": [("hooks/ui/pane-buttons.tsx", 'label="Hand to Claude" hotkey="s"', 'label="Hand to Claude" hotkey="h"')],
    "M40": [("hooks/lib/backoff.ts", "cliSilenceS: 80,", "cliSilenceS: 70,")],
    "M41": [("hooks/ui/org-tab.tsx",
             "        await acknowledgeOrg(org.ack)\n",
             "        await acknowledgeOrg(org.ack)\n"
             "        await host.setStatus({ ...ORG_STATUS_IDLE, orgTabAck: { v: 1 } } as never)\n")],
    "M42": [("hooks/ui/org-tab.tsx", "  if (isKnown) org.feed.start()\n", "  org.feed.start()\n")],
    "M43": [("hooks/ui/org-tab.tsx", "        await acknowledgeOrg(org.ack)\n", "")],
    "M44": [("hooks/lib/org-ack.ts", " && (kept as { v?: unknown }).v === ACKNOWLEDGED.v", "")],
    "M45": [("hooks/lib/org-feed.ts",
             "if (code === EXIT_NO_IDENTITY || code === EXIT_REFUSED) {", "if (code === EXIT_REFUSED) {")],
    "M46": [("hooks/lib/org-window.ts", "WINDOW_BUDGET = 60000", "WINDOW_BUDGET = 600000")],
    "M47": [("hooks/ui/org-tab.tsx",
             "    const effects = stepOrgKeys(store, keys().map((key): KeyEvent => ({ key })))\n    await host.redraw()\n",
             "    const effects = stepOrgKeys(store, keys().map((key): KeyEvent => ({ key })))\n"
             "    await host.setStatus({ ...status, notice: JSON.stringify(windowOf(store)) } as never)\n"
             "    await host.redraw()\n")],
    "M48": [("hooks/lib/org-key-post.ts", "const seen = post.epoch === vi.epoch ? vi.seq : 0", "const seen = 0")],
    "M49": [("hooks/ui/org-keys-input.ts", "if (effect === 'inbox') return leaveOrg(org, host)", "if (effect === 'inbox') return")],
    "M50": [("hooks/register-org.ts", "if (reason !== 'clear' && reason !== 'resume') stop()", "stop()")],
    "M51": [("hooks/register-org.ts", "if (reason !== 'clear' && reason !== 'resume') stop()", "void reason")],
    "M52": [("hooks/register-org.ts", "if (e.id === INBOX_PANE.id) org.stop()", "")],
    "M53": [("hooks/register-org.ts", "    feed?.stop()\n", "")],
    "M54": [("hooks/ui/org-tab.tsx", "  org.feed.stop()\n  closeReader()\n", "  closeReader()\n")],
    "M55": [("hooks/lib/org-key-post.ts", "keys.length > MAX_POSTED_KEYS", "false")],
    "M56": [("hooks/lib/org-keys.ts", " && !/\\p{C}/u.test(key)", "")],
    "M58": [("hooks/lib/org-findings.ts", "  if (store.findings.some((found) => found.groupId === groupId && found.gapKey === gapKey)) return\n", "")],
    "M59": [("hooks/lib/org-findings.ts", "found.groupId === groupId && found.gapKey === gapKey", "found.gapKey === gapKey")],
    "M60": [("hooks/lib/org-findings.ts", "  store.findings.splice(FINDINGS_LIMIT)\n", "")],
    "M61": [("hooks/lib/org-findings.ts", "if (latest === undefined) return { bar: [], lines: [] }", "if (latest === undefined) return { bar: [safeLine('0 findings', columns)], lines: [] }")],
    "M62": [("hooks/lib/org-findings.ts", "`In ${handles.get(groupId) ?? groupId.slice(0, SHORT_ID_CHARS)}: ${sentence}`", "sentence")],
    "M63": [("hooks/lib/org-keys.ts", "  if (store.findings.length === 0) store.vi.isFindingsOpen = false\n", "")],
    "M64": [("hooks/lib/org-keys.ts", "k.key === 'f' || k.key === 'q' ? { isFindingsOpen: false } : {}", "{ isFindingsOpen: false }")],
    "M65": [("hooks/ui/org-tab.tsx", "{findings.length > 0 && <Button key=\"findings\"", "{<Button key=\"findings\"")],
    "M66": [("hooks/ui/org-tab.tsx", "findings.length >= FINDINGS_LIMIT && ", "")],
    "M67": [("hooks/register-org.ts", "else if (frame.kind === 'finding') addOrgFinding(store, frame)", "else if (frame.kind === 'finding') return")],
    "M68": [("hooks/ui/band.tsx", "await foldListed($).catch(() => undefined)", "void 0")],
    "M69": [("hooks/ui/band.tsx", "tail: tailText(folded.length)", "tail: undefined")],
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
