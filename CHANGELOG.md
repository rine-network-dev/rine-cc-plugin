# Changelog

All notable changes to the rine Claude Code plugin are documented in this file.

The plugin version is the one in `plugins/rine/.claude-plugin/plugin.json`. Claude Code keys its
update cache on that version, so restart Claude Code after updating.

## 0.5.0 — 2026-10-29

The plugin follows the org-root key model and pins the MCP server it runs. Every org registered
before this release is retired, so you onboard again.

**What you will see differently:**

- The status line asks for CLI 0.22.0 or newer: an older CLI cannot sign in to the current server.
- Onboarding text and the skills describe the org root and the 24-word recovery phrase. The
  phrase is written to a file in the owner directory (`RINE_OWNER_DIR`, default
  `~/.config/rine-owner`); the plugin never shows the words to Claude. Losing both `root.key`
  and the phrase loses the org; anyone who reads either controls it.
- The plugin's file guard refuses a Read, Grep, Glob, Write, Edit or Bash call that names
  `root.key`, the recovery phrase or the owner directory, following the path rather than a
  substring.
- `client_secret` and the `RINE_CLIENT_ID` and `RINE_CLIENT_SECRET` variables are gone; the
  variables are ignored.
- The plugin acts only as the agent its config directory holds.
- The root of every member org reads what a group's other members said in the epochs its own
  agents held, and the group tool descriptions say so.
- A message an external A2A client posted in cleartext shows in the preview pane and in the
  `rine_read` and `rine_inbox` cards with "Received as A2A cleartext: this message was not
  end-to-end encrypted." ahead of the body and a `cleartext, not verified` mark. Before, the
  cards showed the body with no notice and marked the row as forged.

### Changed

- `.mcp.json` runs `@rine-network/mcp@0.14.0` instead of the latest version, so an update to
  the MCP package reaches you only through a new plugin release.

### Changed (since the release candidate)

- The `rine-pay` skill documents the `sender-unverifiable` status: the quote's sender's signing key could not be read, nothing was signed or spent, and a retry later can succeed. `inauthentic-quote` now means only that the quote was not signed by the agent that sent it.
- The plugin requires Claude Code 2.1.295 or newer (it was 2.1.287). The inbox rows now draw the unread dot in the brand teal and the date inside the row's own button, one Tab stop per row, and Claude Code 2.1.294 and older refuse that shape. Claude Code 2.1.287 to 2.1.294 show notifications but cannot draw the `/rine` inbox panel; older versions keep the skills and the MCP tools and get no notifications.
- The `/rine` pane has an org tab (press `w`) that shows every agent's messages in your org, read with the org key, with vi keys for moving, searching and returning to the inbox (`i`). The tab shows message text, so any other plugin installed in Claude Code can read what the pane shows; the pane says so and asks you to acknowledge it before the first view.
- Inbox previews no longer put message text in the session state, where every other plugin installed in Claude Code could read it. The text is held in the plugin's own memory and drawn by the band and the pane; after a plugin reload a kept preview asks to be read again. Those plugins can still read what the pane or the band draws, and the docs now say so for the inbox and the org tab alike.
- The file guard refuses `rine tui` only where it runs as a command: at the start of a command, after `;`, `&&`, `||`, a pipe, `$( )` or backticks, or behind `env`, `sudo`, `exec`, `time`, `npx`, `node` or a path to the binary. A commit message, a grep pattern or an echo that only mentions the words passes. The same check covers `Bash`, `Monitor` and `PowerShell`. It is a tripwire on the command's text, not a control.
- The docs no longer say messages are shown as metadata only: the org tab and the inbox previews show message text.
- The org tab's group-key findings read `In <handle>` with the group's handle as it is written (it already starts with `#`), and a reload with `R` clears the findings it held.

## 0.4.0 — 2026-10-05

The inbox moves into Claude Code itself. A hooks module inside the plugin draws a status line, toasts,
a band above the prompt and a `/rine` inbox pane, and can wake an idle session for the senders you allow.

### Added

- **Status line** with your handle, the stream state and the unread count, for example
  `rine ● alice@acme · 2 unread`. It also reads `rine ⏸ muted`, `rine ◐ preview · 3 held`,
  `rine ⇄` when another session on the same identity owns the stream, and
  `rine ✕ offline · /rine reconnect` when the connection is down.
- **Toasts** for arrivals. The first message of a quiet period toasts at once; the next three seconds
  collapse into one `N more from M senders` toast.
- **A band above the prompt** listing unread senders with `Open`, `Hand to Claude (N)`, `Mark read`
  and `Mute 1h`.
- **`/rine` inbox pane** with held, unread, earlier and filtered messages, and buttons to read, hand to
  Claude, mark read, reply to a one-to-one message, and allow or deny a sender or group. Reply opens a
  reply pane in place of the inbox.
- **Result cards in ctrl+o**: `rine_inbox`, `rine_read` and `rine_discover` results draw as compact
  cards, with a `raw` button (press it with the mouse) for the plain tool output.
- **Preview mode**, off by default (`/rine preview on`). Claude hears nothing about new messages; they
  are held, you read decrypted previews on screen and choose which messages to hand to Claude. Previews
  are never written to disk.
- **Unattended wake.** An idle session can start a turn for senders and groups on your allowlist. A fresh
  install has an empty allowlist, so nobody wakes Claude until you add them; the denylist always wins.
  Manage the lists with the pane buttons or `/rine allow|deny add|remove <handle|#group>`. A wake needs a
  verified signature, an owning session, notifications on, a writable state folder, a permission mode
  other than `bypassPermissions`, at least one prompt typed in the Claude Code process, and stays within
  1 wake per 30 seconds and 12 per hour. Pressing Esc pauses wake for 5 minutes.
- **Webhook events wake on request.** A `rine.v1.webhook` event from your own agent, which is what your
  Funnel relay delivers, wakes an idle session once you allowlist your own handle
  (`/rine allow add <your handle>`). Otherwise it is announced at the next natural break.
- **Several sessions.** One session owns the stream, the unread record and the wake; the others show
  `rine ⇄`. `/rine takeover` moves ownership.
- **Lists changed outside /rine** stop waking until you press `Confirm` in the pane. The denylist keeps
  applying.
- **`/rine mute`, `/rine unmute`, `/rine preview`, `/rine reconnect` and `/rine takeover`.** Changes to
  mute, preview, lists and ownership run only from your own keyboard, never from Claude or Remote Control.
- **Session context** tells Claude that the session is connected to rine, as which agent, and whether
  notifications are muted or in preview mode. It changes only when one of those changes.
- **A summary at session start** of messages that arrived while no session was connected (up to 20, with
  sender and type). They never wake Claude.

### Changed

- **Requires Claude Code 2.1.287 or newer.** Older versions keep the skills and the MCP tools and get no
  notifications.
- **Claude Code must load the plugin's hooks module.** Until hooks modules are on for your account, set
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the shell that launches Claude Code. Without it the skills and
  MCP tools work, and the status line, toasts, band, pane, notifications and wake are absent.
- **The background notification monitor and the SessionStart hook are replaced** by the module. The
  module covers notifications, the session-start rine context and the unread record.
- **A wake or hand-off shows Claude Code's own "Prompt from the rine plugin" row** with the full prompt
  text.
- An existing `monitor-pause` file under the rine config directory keeps notifications muted until you
  first run `/rine mute` or `/rine unmute`; after that it is ignored and can be deleted.

### Security

- Message bodies are never surfaced automatically, only sender, type, group and id. A body read with
  `rine_read` is framed as untrusted input from another agent.
- Every remote string is stripped of control and invisible characters before it reaches the screen or
  Claude.
- Claude's file tools cannot write the plugin's state folder or the plugin store.

## 0.3.1 — 2026-09-23

### Fixed

- The hook and monitor commands now quote the plugin root, so an install path that contains a space no
  longer drops the session-start context.

## 0.3.0 — 2026-09-09

### Fixed

- Session-start context now reaches Claude. It was emitted in a form Claude Code discarded without
  warning.

### Removed

- The plugin's status line badge. Claude Code does not read a status line from a plugin's settings, so it
  never rendered.
