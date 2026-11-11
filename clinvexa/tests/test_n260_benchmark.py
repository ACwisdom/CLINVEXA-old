from __future__ import annotations

import json
from pathlib import Path

import pytest

from benchmarks.n260.run_benchmark import (
    BenchmarkAssertions,
    BenchmarkCase,
    OpenAICompatibleClient,
    build_parser,
    evaluate_response,
    load_cases,
    percentile_95,
)


def test_benchmark_defaults_to_clinvexa_work_port_8001(tmp_path: Path) -> None:
    args = build_parser().parse_args(
        [
            "--cases",
            str(tmp_path / "cases.jsonl"),
            "--chat-model",
            "synthetic-model",
            "--output",
            str(tmp_path / "result.json"),
        ]
    )

    assert args.base_url == "http://127.0.0.1:8001"


def _write_cases(path: Path, count: int) -> None:
    rows = [
        {
            "case_id": f"case-{index:02d}",
            "synthetic": True,
            "source_provenance": "fully_synthetic",
            "kind": "medical_record_draft" if index < 10 else "multi_agent",
            "messages": [{"role": "user", "content": f"case {index}"}],
            "expected": {
                "must_contain": [f"case {index}"],
                "must_not_contain": ["forbidden"],
            },
        }
        for index in range(count)
    ]
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows),
        encoding="utf-8",
    )


def test_load_cases_requires_twenty_unique_deidentified_cases(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 19)

    with pytest.raises(ValueError, match="exactly 20"):
        load_cases(cases_path)


def test_load_cases_accepts_chat_and_asr_contracts(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 20)

    cases = load_cases(cases_path)

    assert len(cases) == 20
    assert isinstance(cases[0], BenchmarkCase)
    assert cases[0].kind == "medical_record_draft"
    assert cases[-1].kind == "multi_agent"


def test_load_cases_rejects_duplicate_case_ids(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 20)
    rows = cases_path.read_text(encoding="utf-8").splitlines()
    duplicate = json.loads(rows[-1])
    duplicate["case_id"] = "case-00"
    rows[-1] = json.dumps(duplicate)
    cases_path.write_text("\n".join(rows), encoding="utf-8")

    with pytest.raises(ValueError, match="case_id values must be unique"):
        load_cases(cases_path)


def test_asr_case_requires_an_existing_audio_file(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 20)
    rows = cases_path.read_text(encoding="utf-8").splitlines()
    asr_case = json.loads(rows[-1])
    asr_case["kind"] = "asr"
    asr_case["audio_path"] = "missing.wav"
    asr_case.pop("messages")
    rows[-1] = json.dumps(asr_case)
    cases_path.write_text("\n".join(rows), encoding="utf-8")

    with pytest.raises(ValueError, match="audio file not found"):
        load_cases(cases_path)


def test_percentile_95_uses_nearest_rank() -> None:
    assert percentile_95([float(value) for value in range(1, 21)]) == 19.0


def test_load_cases_requires_assertions(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 20)
    rows = cases_path.read_text(encoding="utf-8").splitlines()
    first = json.loads(rows[0])
    first.pop("expected")
    rows[0] = json.dumps(first)
    cases_path.write_text("\n".join(rows), encoding="utf-8")

    with pytest.raises(ValueError, match="expected assertions required"):
        load_cases(cases_path)


def test_load_cases_requires_explicit_synthetic_provenance(tmp_path: Path) -> None:
    cases_path = tmp_path / "cases.jsonl"
    _write_cases(cases_path, 20)
    rows = cases_path.read_text(encoding="utf-8").splitlines()
    first = json.loads(rows[0])
    first["synthetic"] = False
    rows[0] = json.dumps(first)
    cases_path.write_text("\n".join(rows), encoding="utf-8")

    with pytest.raises(ValueError, match="explicitly marked fully synthetic"):
        load_cases(cases_path)


def test_evaluate_response_reports_missing_and_forbidden_content() -> None:
    assertions = BenchmarkAssertions(
        must_contain=("allergy_conflict", "requires_human_review"),
        must_not_contain=("auto_corrected=true",),
    )

    passed, failures = evaluate_response(
        '{"allergy_conflict": true, "auto_corrected=true": true}',
        assertions,
    )

    assert passed is False
    assert failures == (
        "missing required content: requires_human_review",
        "forbidden content present: auto_corrected=true",
    )


def test_evaluate_response_can_require_json_object() -> None:
    assertions = BenchmarkAssertions(
        must_contain=("record_id",),
        must_not_contain=(),
        require_json_object=True,
    )

    assert evaluate_response('{"record_id": "SYN-01"}', assertions) == (True, ())
    assert evaluate_response("not json record_id", assertions) == (
        False,
        ("response is not a JSON object",),
    )


def test_chat_case_requests_json_response_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    client = OpenAICompatibleClient(
        "https://example.invalid/compatible-mode/v1",
        "qwen3.5-27b",
        "",
    )
    case = BenchmarkCase(
        case_id="SYN-JSON",
        kind="medical_record_draft",
        messages=({"role": "user", "content": "return JSON"},),
        assertions=BenchmarkAssertions(("required_key",), ("forbidden",), require_json_object=True),
    )

    def fake_post_json(url: str, payload: dict[str, object]) -> dict[str, object]:
        captured.update(payload)
        return {"choices": [{"message": {"content": '{"status":"ok"}'}}]}

    monkeypatch.setattr(client, "_post_json", fake_post_json)

    assert client.run(case) == '{"status":"ok"}'
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["temperature"] == 0
    contract_message = captured["messages"][-1]  # type: ignore[index]
    assert contract_message["role"] == "system"
    assert "required_key" in contract_message["content"]
    assert "forbidden" not in contract_message["content"]
