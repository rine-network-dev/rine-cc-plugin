# Base image for the CONTAINED Claude Code plugin probe rig.
# Claude Code installs INSIDE the container, and the rine CLI is seeded into it from this tree
# (see ../../compose.cc.yml and seed-tree-mcp.sh).
# Nothing Claude-Code-related is ever installed on the host — every install, build,
# typecheck and probe for this plugin happens inside this container, and a devDependency
# pulled in "for types only" still counts as a host install.
#
# Conventions mirrored from rine-openclaw/Dockerfile: node:24-bookworm-slim, npm noise off,
# CI=true, a long-lived default CMD so `run --rm cc <cmd>` one-shots work.
FROM node:24-bookworm-slim

# curl and jq are gone: the plugin is a hooks module and runs no shell script, and no probe
#   greps as using either (verified by grep over rig/ when they were dropped).
# python3 + python3-yaml: the auth-less probes parse SKILL.md frontmatter, plugin.json and the
#   debug log, and the e2e reads the session JSONL with it.
# tmux + procps: the interactive e2e drives a real `claude` REPL through a tmux pane
#   (capture-pane, send-keys) and counts child processes with ps/pgrep.
# git + ca-certificates: npm/git deps and TLS.
# ripgrep: Claude Code ships its own, but a system rg is the documented fallback
#   (https://code.claude.com/docs/en/setup#additional-dependencies).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git python3 python3-yaml ripgrep tmux procps \
 && rm -rf /var/lib/apt/lists/*

# Pinned, never floating. The docs are explicit that the npm package is the way to pin a
# Claude Code version for reproducible builds, and that pinning requires DISABLE_AUTOUPDATER:
#   "The Dev Container Feature always installs the latest Claude Code release. To pin a
#    specific Claude Code version for reproducible builds, install it from your Dockerfile
#    with `npm install -g @anthropic-ai/claude-code@X.Y.Z` instead of using the feature, and
#    set DISABLE_AUTOUPDATER as shown above."
#   — https://code.claude.com/docs/en/devcontainer#enforce-organization-policy
# CLAUDE_CODE_VERSION is the Claude Code release the plugin is tested against. Moving it is a
# deliberate act: rebuild the image, then run the battery — the mod's module API is early access
# and moves between releases, so mod-test and mod-headless are what notice a release that stops
# accepting a shape the plugin uses. validate.sh V1 reads this line, so an image built from an
# older pin goes red rather than measuring the wrong host.
ARG CLAUDE_CODE_VERSION=2.1.295

# The plugin's scripts shell out to `rine` and gate every mode decision on `command -v rine`,
# a binary-presence check with no version floor: an old CLI is indistinguishable from a
# current one to that check alone. The image therefore carries NO `rine`: seed-tree-mcp.sh packs
# THIS tree's rine-cli and installs it into the scratch volume at run time, because the CLI the
# plugin is written against is the one this tree is about to release, and that release is not on
# the registry yet. The ENV PATH below is what puts the seeded binary in front of everything,
# for one-shot runs and `docker exec` alike.
#   - installing the published CLI here would make every probe measure a release a user
#     already has, and fail on the first verb a tree adds;
#   - mounting ./rine-cli/dist would depend on a host build, and a stale gitignored dist reads
#     as a wrong branch, not a missing feature — the seed refuses a dist that differs from the
#     one it packs, and ci.sh refuses a dist older than its sources before the rig starts.
# RINE_CLI_VERSION is the version the seeded CLI must report: validate.sh V2 reads this line, so
# a tree whose CLI moved without the pin (or an image whose PATH skips the seeded binary) goes
# red instead of measuring the wrong CLI.
ARG RINE_CLI_VERSION=0.22.0

# The last Claude Code release that skips the hooks module instead of running it, for
# old-cc-load.sh: a side-by-side install under /opt/claude-old, so the leg needs no second image
# and runs inside run.sh on whatever tag ci.sh uses. The 2.1.280 validator rejects shapes
# 2.1.295 accepts, so that leg never runs `plugin validate`.
ARG OLD_CLAUDE_CODE_VERSION=2.1.280

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm install --prefix /opt/claude-old "@anthropic-ai/claude-code@${OLD_CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

ENV CC_OLD_CLAUDE=/opt/claude-old/node_modules/.bin/claude
ENV PATH=/work/scratch/node_modules/.bin:${PATH}

ENV npm_config_fund=false \
    npm_config_audit=false \
    CI=true \
    DISABLE_AUTOUPDATER=1

# The scratch and creds mountpoints must exist and be owned by the non-root user BEFORE the
# named volume is created: docker seeds a fresh volume from the image directory, ownership
# included, so a mountpoint that only exists at `docker run` time comes up root-owned and every
# probe that writes to it fails — while a probe that does not check its own write reports green.
RUN mkdir -p /work/scratch /work/creds /work/creds-b /work/rine-cc-plugin /work/rig \
 && chown -R node:node /work

WORKDIR /work/scratch

# Long-lived by default; one-shot tasks use
# `docker compose -f compose.cc.yml run --rm --user "$(id -u):$(id -g)" cc <cmd>`.
CMD ["sleep", "infinity"]
