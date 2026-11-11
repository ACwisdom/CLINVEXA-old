from __future__ import annotations

import json
import re
from pathlib import Path

from benchmarks.n260.run_benchmark import BenchmarkCase, load_cases, run_benchmark


CASE_PATH = (
    Path(__file__).resolve().parents[2]
    / "benchmarks"
    / "n260"
    / "clinvexa-synthetic-cases.jsonl"
)


def test_stage_zero_case_set_has_twenty_valid_synthetic_cases() -> None:
    cases = load_cases(CASE_PATH)

    assert len(cases) == 20
    assert {case.case_id for case in cases} == {
        f"SYN-DC-{index:03d}" for index in range(1, 21)
    }


def test_stage_zero_case_set_covers_required_v1_behaviors() -> None:
    rows = [json.loads(line) for line in CASE_PATH.read_text(encoding="utf-8").splitlines()]
    features = {row["feature"] for row in rows}

    assert {
        "outpatient_record_structuring",
        "allergy_conflict",
        "chronology_quality_control",
        "ocr_low_confidence",
        "one_page_patient_summary",
        "followup_plan_draft",
        "knowledge_answer_without_source",
        "three_agent_routing",
        "asr_unavailable_contract",
    }.issubset(features)


def test_stage_zero_case_set_contains_no_direct_identifier_patterns() -> None:
    content = CASE_PATH.read_text(encoding="utf-8")

    assert re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", content) is None
    assert re.search(r"(?<!\d)\d{17}[0-9Xx](?!\d)", content) is None
    assert all(marker not in content for marker in ("身份证号", "手机号", "详细地址"))


def test_all_twenty_cases_complete_the_functional_evaluation_pipeline() -> None:
    cases = load_cases(CASE_PATH)

    class ContractClient:
        def run(self, case: BenchmarkCase) -> str:
            assert case.assertions is not None
            return json.dumps(
                {"contract_evidence": " ".join(case.assertions.must_contain)},
                ensure_ascii=False,
            )

    evidence = run_benchmark(
        cases,
        ContractClient(),  # type: ignore[arg-type]
        duration_seconds=0.000001,
        concurrency=3,
    )

    assert evidence["request_failure_count"] == 0
    assert evidence["assertion_failure_count"] == 0
    assert len(evidence["latest_case_results"]) == 20
    assert all(evidence["gate"].values())
