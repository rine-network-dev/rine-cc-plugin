---
name: rine-notify
description: Toggle real-time rine wake notifications for this project (or globally).
disable-model-invocation: true
---

# /rine-notify

Toggle real-time rine message notifications. By default, rine only updates the statusline count. When enabled, Claude wakes and speaks up when new messages arrive.

## Usage

The user may type `/rine-notify` with an optional argument:
- `/rine-notify` or `/rine-notify on` — enable for this project
- `/rine-notify off` — disable for this project
- `/rine-notify global` — enable for all projects
- `/rine-notify status` — show current state

## Steps

### 1. Check current state

```bash
# Project-level
jq -r '.env.RINE_NOTIFY // empty' .claude/settings.local.json 2>/dev/null
# Global
jq -r '.env.RINE_NOTIFY // empty' ~/.claude/settings.json 2>/dev/null
```

If the user typed `/rine-notify status`, report which level is active (project, global, or neither) and stop.

### 2. Toggle on (project-level — default)

If the user typed `/rine-notify` or `/rine-notify on`:

1. Read `.claude/settings.local.json`. If it doesn't exist, create it:
   ```bash
   mkdir -p .claude
   echo '{}' > .claude/settings.local.json
   ```
2. Set the env var (persists across restarts):
   ```bash
   jq '.env.RINE_NOTIFY = "1"' .claude/settings.local.json > .claude/settings.local.json.tmp && mv .claude/settings.local.json.tmp .claude/settings.local.json
   ```
3. Activate immediately for the current session:
   ```bash
   $CLAUDE_PLUGIN_ROOT/scripts/notify-toggle.sh on
   ```
   If the script exits non-zero, report the error output to the user instead of confirming. Common causes: no rine credentials (run /rine-setup first), daemon failed to start.
4. If the toggle succeeded, tell the user: **"Notifications enabled — active now for this session and persisted for future sessions."**

### 3. Toggle on (global)

If the user typed `/rine-notify global`:

Same as above but target `~/.claude/settings.json` for step 2. Be careful to preserve all existing fields — only add/update `.env.RINE_NOTIFY`. Still run `notify-toggle.sh on` for immediate activation.

### 4. Toggle off

If the user typed `/rine-notify off`:

1. Remove from project settings:
   ```bash
   jq 'del(.env.RINE_NOTIFY) | if .env == {} then del(.env) else . end' .claude/settings.local.json > .claude/settings.local.json.tmp && mv .claude/settings.local.json.tmp .claude/settings.local.json
   ```
2. Also check and remove from global settings if present:
   ```bash
   jq 'del(.env.RINE_NOTIFY) | if .env == {} then del(.env) else . end' ~/.claude/settings.json > ~/.claude/settings.json.tmp && mv ~/.claude/settings.json.tmp ~/.claude/settings.json
   ```
3. Deactivate immediately for the current session:
   ```bash
   $CLAUDE_PLUGIN_ROOT/scripts/notify-toggle.sh off
   ```
4. Tell the user: **"Notifications disabled — takes effect immediately."**

## Important

- `.claude/settings.local.json` is automatically gitignored by Claude Code.
- Only touch the `.env.RINE_NOTIFY` field — never modify other settings.
- The `notify-toggle.sh` script creates/removes the per-session events directory that `wake.sh` gates on, so changes take effect without restarting CC.
