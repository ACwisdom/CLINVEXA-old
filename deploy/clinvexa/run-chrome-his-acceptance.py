"""Run repeated end-to-end CLINVEXA writes against the simulated Chrome HIS.

The test intentionally uses the same CuaDriverBackend shipped with the desktop
application.  It never clicks the formal-save button: each iteration fills all
six draft fields and verifies their UIA values from a fresh snapshot.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from tools.computer_use.cua_backend import CuaDriverBackend


FIELD_LABELS = ("主诉", "现病史", "检查摘要", "初步诊断", "随访计划", "处置计划")


def _find_window(backend: CuaDriverBackend) -> dict:
    candidates = [
        row
        for row in backend.list_windows()
        if "CLINVEXA 模拟 HIS" in str(row.get("title", ""))
        and "chrome" in str(row.get("app_name", "")).casefold()
    ]
    if not candidates:
        raise RuntimeError("未找到 Chrome 中的 CLINVEXA 模拟 HIS 窗口")
    return candidates[0]


def _field(capture, label: str):
    return next(
        (
            element
            for element in capture.elements
            if element.role in {"Edit", "AXTextField", "AXTextArea"}
            and element.label == label
        ),
        None,
    )


def _write_with_recovery(backend, target, label: str, value: str) -> tuple[bool, str]:
    last = ""
    for _ in range(2):
        capture = backend.capture(mode="som", **target)
        element = _field(capture, label)
        if element is None:
            last = "control_missing"
            continue
        result = backend.set_value(value, element=element.index)
        last = result.code or result.message
        if result.ok and result.effect != "suspected_noop":
            verify = backend.capture(mode="som", **target)
            actual_element = _field(verify, label)
            actual = "" if actual_element is None else str(actual_element.attributes.get("value") or "")
            if actual == value:
                return True, "native_set_value"

    # Bounded foreground fallback: exact element, select-all, type, read back.
    capture = backend.capture(mode="som", **target)
    element = _field(capture, label)
    if element is None:
        return False, last or "control_missing"
    clicked = backend.click(
        element=element.index,
        bring_to_front=True,
        delivery_mode="foreground",
    )
    if not clicked.ok or clicked.verified is False:
        return False, clicked.code or clicked.message or "focus_failed"
    selected = backend.key("ctrl+a", delivery_mode="foreground", bring_to_front=True)
    if not selected.ok or selected.verified is False:
        return False, selected.code or selected.message or "select_all_failed"
    typed = backend.type_text(value, delivery_mode="foreground", bring_to_front=True)
    if not typed.ok or typed.verified is False:
        return False, typed.code or typed.message or "type_failed"
    verify = backend.capture(mode="som", **target)
    actual_element = _field(verify, label)
    actual = "" if actual_element is None else str(actual_element.attributes.get("value") or "")
    return actual == value, "foreground_type" if actual == value else "readback_mismatch"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.runs < 20:
        raise SystemExit("验收次数不得少于 20")

    report = {
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "runs_requested": args.runs,
        "runs": [],
    }
    backend = CuaDriverBackend(permission_mode="unrestricted")
    backend.start()
    try:
        window = _find_window(backend)
        target = {
            "app": str(window["app_name"]),
            "pid": int(window["pid"]),
            "window_id": int(window["window_id"]),
        }
        report["target"] = window
        for run_index in range(1, args.runs + 1):
            started = time.perf_counter()
            fields = {
                label: f"验收{run_index:02d}-{label}-张明-20260814"
                for label in FIELD_LABELS
            }
            outcomes = {}
            for label, value in fields.items():
                ok, route = _write_with_recovery(backend, target, label, value)
                outcomes[label] = {"ok": ok, "route": route}
                if not ok:
                    break
            report["runs"].append(
                {
                    "run": run_index,
                    "ok": len(outcomes) == len(fields)
                    and all(item["ok"] for item in outcomes.values()),
                    "duration_seconds": round(time.perf_counter() - started, 3),
                    "fields": outcomes,
                }
            )
            print(
                f"[{run_index:02d}/{args.runs}] "
                f"{'PASS' if report['runs'][-1]['ok'] else 'FAIL'} "
                f"{report['runs'][-1]['duration_seconds']}s",
                flush=True,
            )
    finally:
        backend.stop()

    passed = sum(1 for row in report["runs"] if row["ok"])
    report["runs_passed"] = passed
    report["runs_failed"] = args.runs - passed
    report["failure_rate"] = round((args.runs - passed) / args.runs, 4)
    report["finished_at"] = datetime.now().isoformat(timespec="seconds")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("runs_passed", "runs_failed", "failure_rate")}, ensure_ascii=False))
    return 0 if report["failure_rate"] < 0.05 else 1


if __name__ == "__main__":
    raise SystemExit(main())
