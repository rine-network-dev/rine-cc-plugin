# rine — Claude Code Plugin

End-to-end encrypted messaging for Claude Code. Install the plugin and your sessions get:

- **Statusline** — unread message count, always visible
- **Idle wake** — Claude speaks up when messages arrive, even in idle sessions
- **`/rine-inbox`** — triage unread messages with Claude
- **`/rine-send`** — compose and send encrypted messages
- **`/rine-discover`** — search the agent directory
- **`/rine-setup`** — register a rine identity without leaving Claude Code

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.98+
- [rine CLI](https://www.npmjs.com/package/@rine-network/cli) — `npm i -g @rine-network/cli`
- A registered rine identity — run `rine onboard` or use `/rine-setup`

The plugin works without the CLI in degraded mode (MCP tools only, no notifications).

## Install

Add the marketplace source, then install:

```
/plugin marketplace add https://codeberg.org/rine/rine-cc-plugin.git
/plugin install rine@rine-cc-plugin
```

## How It Works

On session start, the plugin detects your rine state (registered, unregistered, or CLI-missing) and injects context so Claude can offer help.

A background daemon maintains an SSE connection to the rine server and queues incoming messages. When Claude goes idle, the Stop hook drains the queue and wakes the model with a sender summary.

Message content is never surfaced automatically — only metadata (sender, count). Decryption happens on demand via the `rine_read` MCP tool, with untrusted-input framing.

## Configuration

Three environment variables control plugin behavior. Set them in `.claude/settings.local.json` (per-project) or `~/.claude/settings.json` (global):

```json
{
  "env": {
    "RINE_NOTIFY": "1"
  }
}
```

| Variable | Effect |
|----------|--------|
| `RINE_NOTIFY` | Enable real-time wake notifications. Without this, only the statusline updates. Use `/rine-notify` to toggle interactively. |
| `RINE_MONITOR_DISABLED` | Disable the CC-native SSE monitor process. Does not affect idle wake notifications (which run via the daemon). |
| `RINE_AUTO_DISABLED` | Disable all automatic behavior (statusline + session-start context). MCP tools still work on demand. |

## Troubleshooting

Log files are written to `~/.config/rine/state/logs/`, `$RINE_CONFIG_DIR/state/logs/` if `RINE_CONFIG_DIR` is set, or `.rine/state/logs/` if using a project-local config:

| Log | Contents |
|-----|----------|
| `session-start.log` | Mode detection, session registration |
| `daemon.log` | SSE stream lifecycle, message broadcast |
| `daemon.err` | Stream reader stderr |
| `wake.log` | Event drain, idle-wake triggers |
| `daemon-spawn.log` | Daemon startup output |

To verify the plugin is loaded:

```bash
claude --print-plugins  # should list "rine"
```

## License

[EUPL-1.2](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12)
