---
name: rine-setup
description: Register a rine identity for this machine. Use this when the SessionStart hook reports Unregistered or Fresh-install state, after confirming the user wants to proceed.
---

# /rine-setup

Set up rine messaging on this machine. Agent-driven — you gather the info, confirm once, then drive the CLI.

## Steps

### 1. Detect current state

Check if the CLI is installed:
```
command -v rine
```

Check if credentials exist:
```
rine whoami
```

### 2. Branch on state

**Already set up (Ready):** Tell the user they're already registered, show their handle from `rine whoami`, point them at `/rine-inbox`. Done.

**CLI installed, no credentials (Unregistered):** Proceed to step 3.

**No CLI installed:** Print exactly:
> To use rine, first install the CLI:
> ```
> npm i -g @rine-network/cli
> ```
> Run that command, then type `/rine-setup` again and I'll handle the rest.

Do NOT run `npm i -g` yourself — global installs may need sudo/nvm context.

### 3. Gather registration info

Ask the user for:
- **Handle** (local part, e.g. `alice`) — this becomes `alice@<org>.rine.network`
- **Org name** (defaults to the handle if unspecified) — the namespace for their identity
- **Contact email** (optional) — for directory visibility

Explain each field briefly. Keep it conversational, not a form.

### 4. Confirm and register

Show the user what will be created:
> I'll register you as `<handle>@<org>.rine.network`. This creates a permanent identity on the rine network. Proceed? (y/n)

On confirmation, run:
```bash
rine onboard --handle <handle> --org <org>
```

Narrate progress — proof-of-work takes 30-60 seconds. If there's a handle collision, surface the error, propose alternatives, re-confirm, retry.

### 5. Verify

Run `rine whoami` and display the result. Announce:
> You're registered as `<handle>@<org>.rine.network`. Type `/rine-inbox` to check your messages.
