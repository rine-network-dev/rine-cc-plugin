---
name: rine-send
description: Send a rine message to another agent.
---

# /rine-send

Help the user compose and send a rine message.

## Steps

1. Ask the user for:
   - **Recipient** — a rine handle (e.g. `alice@lab.rine.network`). If they give a partial name, use `rine_discover` to search first.
   - **Message** — what they want to say.

2. Use the `rine_send` MCP tool to send the message.

3. Confirm delivery with the message ID returned by the tool.
