# Base image for the CONTAINED Claude Code plugin probe rig.
# Claude Code and the rine CLI install INSIDE the container (see ../../compose.cc.yml).
# Nothing Claude-Code-related is ever installed on the host — every install, build,
# typecheck and probe for this plugin happens inside this container, and a devDependency
# pulled in "for types only" still counts as a host install.
#
# Conventions mirrored from rine-openclaw/Dockerfile: node:24-bookworm-slim, npm noise off,
# CI=true, a long-lived default CMD so `run --rm cc <cmd>` one-shots work.
FROM node:24-bookworm-slim

# curl + jq: the plugin's own scripts shell out to them (session-start.sh's ready branch and
#   monitor-stream.sh). Both are still required — only the statusline that also used jq is gone.
# python3 + python3-yaml: the auth-less probes parse SKILL.md frontmatter and the hook's
#   JSON envelope, and stand up a local poll endpoint so the `ready, count>0` hook branch
#   is reachable without a network or a real identity.
# git + ca-certificates: npm/git deps and TLS.
# ripgrep: Claude Code ships its own, but a system rg is the documented fallback
#   (https://code.claude.com/docs/en/setup#additional-dependencies).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl jq git python3 python3-yaml ripgrep \
 && rm -rf /var/lib/apt/lists/*

# Pinned, never floating. The docs are explicit that the npm package is the way to pin a
# Claude Code version for reproducible builds, and that pinning requires DISABLE_AUTOUPDATER:
#   "The Dev Container Feature always installs the latest Claude Code release. To pin a
#    specific Claude Code version for reproducible builds, install it from your Dockerfile
#    with `npm install -g @anthropic-ai/claude-code@X.Y.Z` instead of using the feature, and
#    set DISABLE_AUTOUPDATER as shown above."
#   — https://code.claude.com/docs/en/devcontainer#enforce-organization-policy
# CLAUDE_CODE_VERSION pins the exact host binary a one-time host measurement used before
# container-only testing was mandated. That measurement proved a nested `hookSpecificOutput`
# envelope reaches the model while a flat, top-level `additionalContext` key is silently
# parsed, rejected and dropped — with the host still reporting the hook a success either way.
# The rig reproduces that measurement, so it must pin the identical binary.
ARG CLAUDE_CODE_VERSION=2.1.260

# The plugin's scripts shell out to `rine` and gate every mode decision on `command -v rine`,
# a binary-presence check with no version floor: an old CLI is indistinguishable from a
# current one to that check alone. The rig therefore installs the PUBLISHED CLI a plugin user
# would actually have, not a host build of rine-cli/dist:
#   - the published CLI is the contract the plugin is written against;
#   - mounting ./rine-cli/dist would make every probe depend on a host build, and a stale
#     gitignored dist reads as a wrong branch, not a missing feature — `git status` cannot
#     see it, and nothing gates it, so a probe run against it would silently test a build
#     nobody shipped;
#   - a lane that needs an unreleased verb overrides this build arg, deliberately and visibly.
ARG RINE_CLI_VERSION=0.20.0

RUN npm install -g \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@rine-network/cli@${RINE_CLI_VERSION}" \
 && npm cache clean --force

ENV npm_config_fund=false \
    npm_config_audit=false \
    CI=true \
    DISABLE_AUTOUPDATER=1 \
    CC_RIG_CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION} \
    CC_RIG_RINE_CLI_VERSION=${RINE_CLI_VERSION}

# The scratch and creds mountpoints must exist and be owned by the non-root user BEFORE the
# named volume is created: docker seeds a fresh volume from the image directory, ownership
# included, so a mountpoint that only exists at `docker run` time comes up root-owned and every
# probe that writes to it fails — while a probe that does not check its own write reports green.
RUN mkdir -p /work/scratch /work/creds /work/rine-cc-plugin /work/rig \
 && chown -R node:node /work

WORKDIR /work/scratch

# Long-lived by default; one-shot tasks use
# `docker compose -f compose.cc.yml run --rm --user "$(id -u):$(id -g)" cc <cmd>`.
CMD ["sleep", "infinity"]
