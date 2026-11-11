#!/usr/bin/env python3
"""End-to-end smoke test for CLINVEXA deterministic medical Skill service."""

from __future__ import annotations

import argparse
import json
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


CASES = [
    {"name": "record-structuring", "expected_suffix": ".xlsx", "required": []},
    {"name": "outpatient-note-draft", "expected_suffix": ".txt", "required": ["主诉", "现病史", "过敏史", "青霉素", "医生复核"]},
    {"name": "followup-plan", "expected_suffix": ".txt", "required": ["3天后", "咳嗽", "血常规", "提前就医", "医生"]},
]


def find_paths(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"output_path", "result_path", "path", "file_path"} and isinstance(item, str):
                found.append(item)
            found.extend(find_paths(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(find_paths(item))
    elif isinstance(value, str):
        found.extend(re.findall(r"[A-Za-z]:\\[^\r\n\"']+?\.(?:xlsx|txt)", value))
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence: dict[str, Any] = {"started_at": datetime.now().astimezone().isoformat(), "base_url": args.base_url, "fixture": str(args.fixture.resolve()), "cases": []}

    for case in CASES:
        payload = {"task": f"对完全合成测试病例执行{case['name']}，只依据原文，不补写事实。", "source_paths": [str(args.fixture.resolve())]}
        started = time.perf_counter()
        row: dict[str, Any] = {**case, "payload": payload, "events": []}
        try:
            response = requests.post(f"{args.base_url}/clinvexa/skills/{case['name']}/invoke/stream", json=payload, timeout=120, stream=True)
            row["status"] = response.status_code
            for raw in response.iter_lines(decode_unicode=True):
                if not raw:
                    continue
                try:
                    row["events"].append(json.loads(raw))
                except json.JSONDecodeError:
                    row["events"].append({"unparsed": raw})
        except Exception as exc:
            row.update({"status": None, "error": f"{type(exc).__name__}: {exc}"})
        row["latency_s"] = round(time.perf_counter() - started, 3)

        candidates = []
        for candidate in find_paths(row["events"]):
            if candidate not in candidates:
                candidates.append(candidate)
        row["output_path_candidates"] = candidates
        existing = [Path(candidate) for candidate in candidates if Path(candidate).exists()]
        row["existing_output_paths"] = [str(path.resolve()) for path in existing]
        selected = next((path for path in existing if path.suffix.lower() == case["expected_suffix"]), None)
        checks = {
            "http_200": row.get("status") == 200,
            "has_multiple_process_events": len(row["events"]) >= 3,
            "expected_output_exists": selected is not None,
            "expected_suffix": selected is not None and selected.suffix.lower() == case["expected_suffix"],
            "required_content": False,
        }
        if selected is not None and selected.suffix.lower() == ".txt":
            text = selected.read_text(encoding="utf-8-sig", errors="replace")
            row["output_text"] = text
            checks["required_content"] = all(token in text for token in case["required"])
        elif selected is not None and selected.suffix.lower() == ".xlsx":
            try:
                with zipfile.ZipFile(selected) as archive:
                    names = archive.namelist()
                    row["xlsx_members"] = names
                    checks["required_content"] = "xl/workbook.xml" in names and any(name.startswith("xl/worksheets/sheet") for name in names)
            except Exception as exc:
                row["xlsx_error"] = str(exc)
        row["checks"] = checks
        row["passed"] = all(checks.values())
        evidence["cases"].append(row)

    passed = sum(case["passed"] for case in evidence["cases"])
    evidence["summary"] = {"passed": passed, "total": len(evidence["cases"]), "rate_pct": round(passed / len(evidence["cases"]) * 100, 2)}
    evidence["finished_at"] = datetime.now().astimezone().isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
