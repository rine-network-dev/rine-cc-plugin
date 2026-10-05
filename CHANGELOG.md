# Changelog

All notable changes to the rine Claude Code plugin are documented in this file.

The plugin version is the one in `plugins/rine/.claude-plugin/plugin.json`. Claude Code keys its
update cache on that version, so restart Claude Code after updating.

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
