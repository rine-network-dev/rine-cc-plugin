#!/usr/bin/env python3
"""hookshape.py — the SessionStart hook-envelope tooling, container-side.

Three subcommands, all offline:

  lint <captured-stdout> <plugin.json> <script> [marker]
      Parse one hook emission and check it against the shape the host accepts:
      exactly one hookSpecificOutput object, the hookEventName the manifest registers FOR
      THAT SCRIPT, and a non-empty additionalContext string. With a marker argument the
      context must also contain that substring — that is how a branch assertion proves it
      reached the branch it meant to. Exit 0 = accepted, 1 = anything wrong.

      The marker is OPTIONAL by design. Requiring one would mean the shipped hook had to
      carry a probe-only environment variable, i.e. test scaffolding in production code and
      an arbitrary string prefixed into the model's context at every session start.

  context <captured-stdout>
      Print the decoded additionalContext. Lets a probe assert on what the frame SAYS —
      a version sentence present or absent, a hostile config path round-tripping — without
      re-implementing JSON unescaping in bash.

  flatten <session-start.sh>
      Rewrite a COPY of the hook so emit_context emits the pre-fix TOP-LEVEL
      {"additionalContext":…} envelope. This is a regression fixture, not a product path:
      the host parses that shape, rejects it with the hint "Did you mean
      hookSpecificOutput.additionalContext (with a hookEventName)?" and ignores it while
      still reporting the hook a success. Exits 1 unless the nested emit format occurs
      exactly once in the file, so a refactor that moved or duplicated it cannot leave the
      fixture silently un-mutated.

The accepted shape is not hardcoded prose: hookEventName is checked against the event whose
plugin.json entry runs the script under test. Checking it against every registered event name
would be weaker than it looks — once a second hook exists, session-start.sh could answer with
the OTHER hook's event name and lint would accept it, which is exactly the class of mistake
this envelope check exists to catch.
"""

import json
import os
import sys

NESTED_FMT = (
    '\'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n\''
)
FLAT_FMT = '\'{"additionalContext":"%s"}\\n\''


def _load_context(path):
    raw = open(path, encoding="utf-8").read().strip()
    if not raw:
        return None, "empty hook output"
    try:
        doc = json.loads(raw)
    except Exception as exc:
        return None, f"hook output is not JSON: {exc}"
    if not isinstance(doc, dict):
        return None, "hook output is not a JSON object"
    return doc, None


def _events_running(manifest, script):
    """The event names whose manifest entries actually run `script`."""
    hooks = json.load(open(manifest, encoding="utf-8")).get("hooks", {})
    want = os.path.basename(script)
    found = []
    for event, entries in hooks.items():
        for entry in entries or []:
            for hook in (entry or {}).get("hooks", []) or []:
                if want in str(hook.get("command", "")):
                    found.append(event)
    return sorted(set(found))


def cmd_lint(argv):
    captured, manifest, script = argv[0], argv[1], argv[2]
    marker = argv[3] if len(argv) > 3 else None
    doc, err = _load_context(captured)
    if err:
        print(err)
        return 1
    events = _events_running(manifest, script)
    if not events:
        print(f"plugin.json registers no hook that runs {os.path.basename(script)}")
        return 1
    if "additionalContext" in doc:
        print(
            "top-level additionalContext — the host parses, rejects and IGNORES this key "
            "(hint: hookSpecificOutput.additionalContext with a hookEventName)"
        )
        return 1
    if set(doc.keys()) != {"hookSpecificOutput"}:
        print(f"unexpected top-level keys: {sorted(doc.keys())}")
        return 1
    hso = doc["hookSpecificOutput"]
    if not isinstance(hso, dict):
        print("hookSpecificOutput is not an object")
        return 1
    name = hso.get("hookEventName")
    if name not in events:
        print(
            f"hookEventName {name!r} is not the event plugin.json registers for "
            f"{os.path.basename(script)}: {events}"
        )
        return 1
    ctx = hso.get("additionalContext")
    if not isinstance(ctx, str) or not ctx.strip():
        print("additionalContext is missing or not a non-empty string")
        return 1
    if marker is not None and marker not in ctx:
        print(f"marker {marker!r} absent from additionalContext: {ctx!r}")
        return 1
    tail = "" if marker is None else f", marker {marker!r} present"
    print(f"accepted: hookEventName={name} additionalContext={len(ctx)} chars{tail}")
    return 0


def cmd_context(argv):
    doc, err = _load_context(argv[0])
    if err:
        print(err, file=sys.stderr)
        return 1
    print(doc.get("hookSpecificOutput", {}).get("additionalContext", ""))
    return 0


def cmd_flatten(argv):
    path = argv[0]
    text = open(path, encoding="utf-8").read()
    touched = text.count(NESTED_FMT)
    if touched != 1:
        print(f"flatten found {touched} nested emit format(s), expected exactly 1")
        return 1
    open(path, "w", encoding="utf-8").write(text.replace(NESTED_FMT, FLAT_FMT, 1))
    print("flattened emit_context to the pre-fix top-level envelope")
    return 0


COMMANDS = {"lint": cmd_lint, "context": cmd_context, "flatten": cmd_flatten}
ARITY = {"lint": 3, "context": 1, "flatten": 1}


if __name__ == "__main__":
    # Guarded dispatch. A typo'd subcommand or a missing argument used to raise KeyError /
    # IndexError, and a traceback on stderr with exit 1 is indistinguishable to the calling
    # probe from "the hook emitted a bad envelope" — the instrument would accuse the product.
    # Usage errors get exit 2 and one line naming what was wrong.
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sub, rest = sys.argv[1], sys.argv[2:]
    if sub not in COMMANDS:
        print(f"unknown subcommand {sub!r}; expected one of {sorted(COMMANDS)}", file=sys.stderr)
        sys.exit(2)
    if len(rest) < ARITY[sub]:
        print(
            f"{sub} needs at least {ARITY[sub]} argument(s), got {len(rest)}",
            file=sys.stderr,
        )
        sys.exit(2)
    sys.exit(COMMANDS[sub](rest))
