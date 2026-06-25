#!/usr/bin/env python3
"""Git pre-commit hook: run the HAR baseline regression gate against LOCAL HAR originals.

Why this lives locally (not in GitHub CI):
- HAR originals contain session tokens / pageIds and are excluded by .gitignore
  (they must NEVER enter the public repo).
- Sanitizing HAR before commit is NOT viable: collapsing pageIds to a single
  placeholder breaks pageId chain tracking and changes the extracted snapshot
  (steps get dropped), so a baseline rebuilt from sanitized HAR would be a
  FALSE gate. Verified empirically: step_count 8->7 / 36->33, step_order breaking.
- Therefore the only trustworthy place to run a REAL HAR baseline compare is an
  environment that already holds the original HARs -- i.e. the developer machine.

This hook fails (blocks the commit) when:
- the manifest references HAR files that are not present locally, or
- the current extraction diverges from the committed baseline.

Bypass (use sparingly, only when you are certain the HAR set is intentionally absent):
    git commit --no-verify
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GATE = REPO_ROOT / "scripts" / "core_regression_gate.py"


def main() -> int:
    if not GATE.exists():
        print(f"[pre-commit] gate script not found: {GATE}", file=sys.stderr)
        return 1

    # --skip-pytest: pre-commit should be fast; full pytest runs in CI.
    # --require-local-har: turn the silent "skip when HAR missing" into a hard failure,
    #   so the gate can NEVER pass silently (the root cause of past regressions slipping in).
    cmd = [
        sys.executable,
        str(GATE),
        "--skip-pytest",
        "--require-local-har",
    ]
    print("[pre-commit] HAR baseline regression gate:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd, cwd=str(REPO_ROOT))
    if result.returncode != 0:
        print(
            "\n[pre-commit] HAR regression gate FAILED -- commit blocked.\n"
            "  - If a real regression: fix it (do not weaken the gate).\n"
            "  - If you intentionally lack the HAR fixtures: rerun with `git commit --no-verify`.",
            file=sys.stderr,
        )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
