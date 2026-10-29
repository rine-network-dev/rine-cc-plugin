#!/usr/bin/env python3
# tools-check.py — leg 2 of mod-headless.sh: tool-name constant vs the engine tool names. Prints PASS/FAIL/INFO rows.
import json, re, sys
tools_path, refs_path = sys.argv[1], sys.argv[2]
lines = []
emit = lambda k, m: lines.append(f"{k}\t{m}")
try:
    names = json.load(open(tools_path))
    assert isinstance(names, list)
except Exception as exc:
    emit("FAIL", f"leg2 tools.json is not a JSON list: {exc}")
    print("\n".join(lines)); raise SystemExit
emit("INFO", f"leg2 engine reported {len(names)} tools")
try:
    text = open(refs_path, encoding="utf-8").read()
except OSError as exc:
    emit("FAIL", f"tool-name constant not found in hooks/lib/refs.ts ({exc})")
    print("\n".join(lines)); raise SystemExit
match = re.search(r"\^mcp__plugin_rine_rine__.*?\$(?=[/'\"`])", text)
if not match:
    emit("FAIL", "tool-name constant not found in hooks/lib/refs.ts")
    print("\n".join(lines)); raise SystemExit
const = match.group(0)
emit("INFO", f"leg2 tool-name constant: {const}")
pattern = re.compile(const)
prefixed = [n for n in names if isinstance(n, str) and n.startswith("mcp__plugin_rine_rine__")]
if not prefixed:
    emit("FAIL", "leg2 no tool name starts with mcp__plugin_rine_rine__ — the MCP server did not register its tools (e.g. rig/seed-tree-mcp.sh did not run, so npx found no rine-mcp)")
else:
    bad = [n for n in prefixed if not pattern.fullmatch(n)]
    if bad:
        emit("FAIL", f"leg2 tool-name constant {const} does not match {bad}")
    else:
        emit("PASS", f"leg2 tool-name constant {const} matches all {len(prefixed)} plugin MCP tool names")
    if "mcp__plugin_rine_rine__rine_whoami" in names:
        emit("PASS", "leg2 mcp__plugin_rine_rine__rine_whoami is among the reported tools")
    else:
        emit("FAIL", "leg2 mcp__plugin_rine_rine__rine_whoami is not among the reported tools")
print("\n".join(lines))
