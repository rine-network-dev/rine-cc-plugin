#!/usr/bin/env python3
"""Static checks for validate.sh: argv[1] is the plugin source root (V5/V6/V7 rows);
with argv[2] == "events" it reads `claude plugin validate --json` from stdin (V8 rows)."""
import json, os, re, sys
import yaml


def emit(kind, msg):
    print(f"{kind}\t{msg}")


def check_static(src, plugin):
    # V5 — every shipped JSON manifest parses.
    docs = {}
    for path in (os.path.join(src, ".claude-plugin", "marketplace.json"),
                 os.path.join(plugin, ".claude-plugin", "plugin.json"),
                 os.path.join(plugin, ".mcp.json"),
                 os.path.join(plugin, "hooks", "hooks.json")):
        rel = os.path.relpath(path, src)
        if not os.path.exists(path):
            emit("FAIL", f"V5 missing manifest {rel}"); continue
        try:
            with open(path) as fh:
                docs[rel] = json.load(fh)
            emit("PASS", f"V5 {rel} parses as JSON")
        except Exception as exc:
            emit("FAIL", f"V5 {rel} does not parse: {exc}")

    # V6 — every SKILL.md has parseable YAML frontmatter with name + description.
    skills_dir = os.path.join(plugin, "skills")
    names = sorted(os.listdir(skills_dir)) if os.path.isdir(skills_dir) else []
    if not names:
        emit("FAIL", "V6 no skills directory")
    for name in names:
        md = os.path.join(skills_dir, name, "SKILL.md")
        rel = os.path.relpath(md, src)
        if not os.path.isfile(md):
            emit("FAIL", f"V6 {name}/ has no SKILL.md"); continue
        text = open(md, encoding="utf-8").read()
        if not text.startswith("---"):
            emit("FAIL", f"V6 {rel} has no YAML frontmatter fence"); continue
        body = text.split("---", 2)
        if len(body) < 3:
            emit("FAIL", f"V6 {rel} frontmatter fence is unterminated"); continue
        try:
            fm = yaml.safe_load(body[1])
        except Exception as exc:
            emit("FAIL", f"V6 {rel} frontmatter is not valid YAML: {exc}"); continue
        if not isinstance(fm, dict):
            emit("FAIL", f"V6 {rel} frontmatter is not a mapping"); continue
        missing = [k for k in ("name", "description") if not fm.get(k)]
        if missing:
            emit("FAIL", f"V6 {rel} frontmatter missing {missing}")
        else:
            emit("PASS", f"V6 {rel} frontmatter ok (name={fm['name']})")

    # V7 — the mod layout: a hooks module replaces the old bash hook scripts and monitors.
    hooks_doc = docs.get(os.path.join("plugins", "rine", "hooks", "hooks.json"))
    plugin_doc = docs.get(os.path.join("plugins", "rine", ".claude-plugin", "plugin.json"))
    if hooks_doc is None:
        emit("FAIL", "V7 hooks/hooks.json unavailable")
    elif set(hooks_doc) != {"modules"} or hooks_doc.get("modules") != ["./register.tsx"]:
        emit("FAIL", f"V7 hooks/hooks.json must be exactly {{'modules': ['./register.tsx']}}, got {hooks_doc}")
    else:
        emit("PASS", "V7 hooks/hooks.json lists exactly the module ./register.tsx")
    if plugin_doc is None:
        emit("FAIL", "V7 plugin.json unavailable")
    elif "hooks" in plugin_doc:
        emit("FAIL", "V7 plugin.json still carries a 'hooks' key — the mod owns the hooks now")
    elif not plugin_doc.get("types"):
        emit("FAIL", "V7 plugin.json has no 'types' key naming the mod's type declarations")
    elif not os.path.exists(os.path.join(plugin, plugin_doc["types"])):
        emit("FAIL", f"V7 plugin.json types '{plugin_doc['types']}' does not exist under the plugin dir")
    else:
        emit("PASS", f"V7 plugin.json types '{plugin_doc['types']}' exists and no hooks key is present")
    if os.path.isfile(os.path.join(plugin, "hooks", "register.tsx")):
        emit("PASS", "V7 hooks/register.tsx exists")
    else:
        emit("FAIL", "V7 hooks/register.tsx is missing — hooks.json names a module that is not shipped")
    stale = [d for d in ("monitors", "scripts") if os.path.exists(os.path.join(plugin, d))]
    if stale:
        emit("FAIL", f"V7 the old bash layout survives: {stale} still exist under the plugin dir")
    else:
        emit("PASS", "V7 neither monitors/ nor scripts/ exists under the plugin dir")


def check_events():
    # V8 — `plugin validate --json` reports the hook events the mod registers in contents[].notes[].
    events = ("session.start session.end prompt.compose turn.start turn.step turn.complete "
              "tool.call command.run ui.render prompt.submit classic.UserPromptSubmit").split()

    def strings(o):
        if isinstance(o, str): yield o
        elif isinstance(o, dict):
            for v in o.values(): yield from strings(v)
        elif isinstance(o, list):
            for v in o: yield from strings(v)

    try:
        doc = json.load(sys.stdin)
    except Exception:
        emit("FAIL", "V8 plugin validate --json did not parse"); return
    text = "\n".join(s for e in doc.get("contents", []) if e.get("type") == "hooks"
                     for s in strings(e.get("notes", [])))
    for ev in events:
        ok = re.search(r"(?<![\w.])" + re.escape(ev) + r"(?![\w])", text)
        emit("PASS" if ok else "FAIL",
             f"V8 plugin validate {'lists' if ok else 'does not list'} hook event {ev}")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "events":
        check_events()
    else:
        src = sys.argv[1]
        plugin = os.path.join(src, "plugins", "rine")
        check_static(src, plugin)
