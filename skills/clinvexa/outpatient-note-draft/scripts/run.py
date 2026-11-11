#!/usr/bin/env python3
"""Fixed entrypoint for the CLINVEXA outpatient-note-draft Skill."""

from __future__ import annotations

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "clinvexa" / "src"))

from clinvexa.deterministic_skills import main


if __name__ == "__main__":
    raise SystemExit(main(["outpatient-note-draft", *sys.argv[1:]]))
