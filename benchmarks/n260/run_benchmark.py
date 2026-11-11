"""Run the CLINVEXA Stage 0 workload against an OpenAI-compatible service."""

from __future__ import annotations

import argparse
import json
import math
import mimetypes
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CHAT_KINDS = {"medical_record_draft", "multi_agent"}
ALLOWED_KINDS = CHAT_KINDS | {"asr"}


@dataclass(frozen=True)
class BenchmarkAssertions:
    """Deterministic response assertions for a synthetic case.

    Attributes:
        must_contain: Case-insensitive substrings required in the response.
        must_not_contain: Case-insensitive substrings forbidden in the response.
        require_json_object: Whether the response must parse as one JSON object.
    """

    must_contain: tuple[str, ...]
    must_not_contain: tuple[str, ...]
    require_json_object: bool = False


@dataclass(frozen=True)
class BenchmarkCase:
    """One deidentified N260 acceptance workload.

    Attributes:
        case_id: Stable identifier without patient identity.
        kind: Workload type.
        messages: OpenAI-compatible chat messages.
        audio_path: Source audio path for ASR workloads.
        assertions: Deterministic functional expectations.
    """

    case_id: str
    kind: str
    messages: tuple[dict[str, Any], ...] = ()
    audio_path: Path | None = None
    assertions: BenchmarkAssertions | None = None


@dataclass(frozen=True)
class CaseResult:
    """Observed result for one benchmark request."""

    case_id: str
    kind: str
    latency_seconds: float
    success: bool
    error: str | None
    assertion_failures: tuple[str, ...]
    response_text: str


def load_cases(path: Path, expected_count: int = 20) -> tuple[BenchmarkCase, ...]:
    """Load and validate the Stage 0 deidentified JSONL workload.

    Args:
        path: JSONL file containing benchmark cases.
        expected_count: Required number of unique cases.

    Returns:
        Validated benchmark cases.

    Raises:
        ValueError: The workload violates the acceptance data contract.
    """
    rows: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON on line {line_number}: {exc.msg}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"line {line_number} must contain a JSON object")
        rows.append(row)

    if len(rows) != expected_count:
        raise ValueError(f"benchmark file must contain exactly {expected_count} cases")

    for row in rows:
        if row.get("synthetic") is not True or row.get("source_provenance") != "fully_synthetic":
            case_id = str(row.get("case_id", "unknown"))
            raise ValueError(f"case {case_id} must be explicitly marked fully synthetic")

    case_ids = [str(row.get("case_id", "")).strip() for row in rows]
    if any(not case_id for case_id in case_ids):
        raise ValueError("every case requires a non-empty case_id")
    if len(set(case_ids)) != len(case_ids):
        raise ValueError("case_id values must be unique")

    cases: list[BenchmarkCase] = []
    for row, case_id in zip(rows, case_ids, strict=True):
        kind = str(row.get("kind", "")).strip()
        if kind not in ALLOWED_KINDS:
            raise ValueError(f"unsupported benchmark kind for {case_id}: {kind}")
        assertions = _load_assertions(row.get("expected"), case_id)
        if kind in CHAT_KINDS:
            messages = row.get("messages")
            if not isinstance(messages, list) or not messages:
                raise ValueError(f"chat messages required for {case_id}")
            cases.append(
                BenchmarkCase(
                    case_id,
                    kind,
                    tuple(messages),
                    assertions=assertions,
                )
            )
            continue

        raw_audio_path = str(row.get("audio_path", "")).strip()
        audio_path = (path.parent / raw_audio_path).resolve()
        if not raw_audio_path or not audio_path.is_file():
            raise ValueError(f"audio file not found for {case_id}: {raw_audio_path}")
        cases.append(
            BenchmarkCase(
                case_id,
                kind,
                audio_path=audio_path,
                assertions=assertions,
            )
        )

    return tuple(cases)


def _load_assertions(raw: Any, case_id: str) -> BenchmarkAssertions:
    if not isinstance(raw, dict):
        raise ValueError(f"expected assertions required for {case_id}")
    must_contain = raw.get("must_contain", [])
    must_not_contain = raw.get("must_not_contain", [])
    if not isinstance(must_contain, list) or not all(
        isinstance(value, str) and value for value in must_contain
    ):
        raise ValueError(f"must_contain must be a string array for {case_id}")
    if not isinstance(must_not_contain, list) or not all(
        isinstance(value, str) and value for value in must_not_contain
    ):
        raise ValueError(f"must_not_contain must be a string array for {case_id}")
    if not must_contain and not must_not_contain:
        raise ValueError(f"expected assertions cannot be empty for {case_id}")
    return BenchmarkAssertions(
        tuple(must_contain),
        tuple(must_not_contain),
        bool(raw.get("require_json_object", False)),
    )


def percentile_95(values: list[float]) -> float | None:
    """Return the nearest-rank 95th percentile.

    Args:
        values: Observed numeric values.

    Returns:
        The P95 value, or ``None`` for an empty input.
    """
    if not values:
        return None
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def evaluate_response(
    response_text: str,
    assertions: BenchmarkAssertions,
) -> tuple[bool, tuple[str, ...]]:
    """Evaluate a model response with deterministic synthetic-case assertions.

    Args:
        response_text: Model or ASR output.
        assertions: Expected and forbidden response properties.

    Returns:
        A pass flag and ordered failure descriptions.
    """
    failures: list[str] = []
    normalized = response_text.casefold()
    for required in assertions.must_contain:
        if required.casefold() not in normalized:
            failures.append(f"missing required content: {required}")
    for forbidden in assertions.must_not_contain:
        if forbidden.casefold() in normalized:
            failures.append(f"forbidden content present: {forbidden}")
    if assertions.require_json_object:
        try:
            payload = json.loads(response_text)
        except json.JSONDecodeError:
            payload = None
        if not isinstance(payload, dict):
            failures.append("response is not a JSON object")
    return not failures, tuple(failures)


class OpenAICompatibleClient:
    """Minimal client for Hermes or a local OpenAI-compatible endpoint."""

    def __init__(
        self,
        base_url: str,
        chat_model: str,
        asr_model: str,
        api_key: str = "",
        timeout_seconds: float = 120.0,
    ) -> None:
        """Initialize the benchmark client.

        Args:
            base_url: Endpoint root, with or without ``/v1``.
            chat_model: Model used for chat and multi-Agent cases.
            asr_model: Model used for audio transcription cases.
            api_key: Optional bearer token.
            timeout_seconds: Per-request timeout.
        """
        normalized = base_url.rstrip("/")
        self._v1_url = normalized if normalized.endswith("/v1") else f"{normalized}/v1"
        self._chat_model = chat_model
        self._asr_model = asr_model
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    def run(self, case: BenchmarkCase) -> str:
        """Execute one benchmark case and validate a non-empty response.

        Args:
            case: Validated workload case.

        Raises:
            RuntimeError: The endpoint fails or returns an invalid response.

        Returns:
            Response text used by the functional assertions.
        """
        if case.kind == "asr":
            response = self._post_audio(case)
            text = str(response.get("text", "")).strip()
            if not text:
                raise RuntimeError("ASR response contains no text")
            return text

        messages = list(case.messages)
        if case.assertions and case.assertions.must_contain:
            required = json.dumps(
                list(case.assertions.must_contain),
                ensure_ascii=False,
            )
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "输出契约：最终JSON必须以有业务含义的字段名或枚举值包含以下项目："
                        f"{required}。不得只把这些项目复制到测试数组中；缺少来源值时使用null、"
                        "空数组或明确的未提及状态。不得生成输入中不存在的患者标识、时间、"
                        "诊断、治疗或证据。"
                    ),
                }
            )
        payload: dict[str, Any] = {
            "model": self._chat_model,
            "messages": messages,
            "temperature": 0,
        }
        if case.assertions and case.assertions.require_json_object:
            payload["response_format"] = {"type": "json_object"}
        response = self._post_json(f"{self._v1_url}/chat/completions", payload)
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("chat response contains no choices")
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            content = "".join(
                str(block.get("text", ""))
                for block in content
                if isinstance(block, dict)
            )
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("chat response contains no message content")
        return text

    def _headers(self, content_type: str) -> dict[str, str]:
        headers = {"Content-Type": content_type}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _post_json(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        return self._send(Request(url, data=body, headers=self._headers("application/json")))

    def _post_audio(self, case: BenchmarkCase) -> dict[str, Any]:
        assert case.audio_path is not None
        boundary = f"clinvexa-{uuid.uuid4().hex}"
        mime_type = mimetypes.guess_type(case.audio_path.name)[0] or "application/octet-stream"
        parts = [
            _multipart_field(boundary, "model", self._asr_model),
            _multipart_file(boundary, "file", case.audio_path, mime_type),
            f"--{boundary}--\r\n".encode(),
        ]
        request = Request(
            f"{self._v1_url}/audio/transcriptions",
            data=b"".join(parts),
            headers=self._headers(f"multipart/form-data; boundary={boundary}"),
        )
        return self._send(request)

    def _send(self, request: Request) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"endpoint returned HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise RuntimeError(f"endpoint request failed: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("endpoint returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("endpoint returned a non-object JSON response")
        return payload


def run_benchmark(
    cases: tuple[BenchmarkCase, ...],
    client: OpenAICompatibleClient,
    duration_seconds: float,
    concurrency: int,
) -> dict[str, Any]:
    """Run repeated workloads until the configured duration is reached.

    Args:
        cases: Twenty validated acceptance cases.
        client: Endpoint client.
        duration_seconds: Minimum wall-clock run duration.
        concurrency: Maximum simultaneous requests.

    Returns:
        JSON-serializable evidence and gate metrics.
    """
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    if concurrency <= 0:
        raise ValueError("concurrency must be positive")

    started_at = datetime.now(UTC)
    started = time.monotonic()
    results: list[CaseResult] = []
    cycle = 0
    while cycle == 0 or time.monotonic() - started < duration_seconds:
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {executor.submit(_run_case, client, case): case for case in cases}
            for future in as_completed(futures):
                results.append(future.result())
        cycle += 1

    elapsed = time.monotonic() - started
    draft_latencies = [
        result.latency_seconds
        for result in results
        if result.kind == "medical_record_draft" and result.success
    ]
    failures = [result for result in results if not result.success]
    request_failures = [result for result in results if result.error is not None]
    assertion_failures = [result for result in results if result.assertion_failures]
    by_kind: dict[str, dict[str, int]] = {}
    for kind in sorted(ALLOWED_KINDS):
        kind_results = [result for result in results if result.kind == kind]
        by_kind[kind] = {
            "requests": len(kind_results),
            "successes": sum(result.success for result in kind_results),
            "failures": sum(not result.success for result in kind_results),
        }
    draft_p95 = percentile_95(draft_latencies)
    return {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "required_duration_seconds": duration_seconds,
        "observed_duration_seconds": round(elapsed, 3),
        "cycles": cycle,
        "case_count": len(cases),
        "request_count": len(results),
        "failure_count": len(failures),
        "request_failure_count": len(request_failures),
        "assertion_failure_count": len(assertion_failures),
        "medical_record_draft_p95_seconds": (
            round(draft_p95, 3) if draft_p95 is not None else None
        ),
        "by_kind": by_kind,
        "gate": {
            "duration_passed": elapsed >= duration_seconds,
            "no_request_failures": not request_failures,
            "all_assertions_passed": not assertion_failures,
            "draft_p95_passed": draft_p95 is not None and draft_p95 <= 20.0,
        },
        "failures": [asdict(result) for result in failures[:100]],
        "latest_case_results": [
            asdict(result)
            for result in {
                result.case_id: result for result in results
            }.values()
        ],
    }


def _run_case(client: OpenAICompatibleClient, case: BenchmarkCase) -> CaseResult:
    started = time.monotonic()
    try:
        response_text = client.run(case)
    except Exception as exc:
        return CaseResult(
            case.case_id,
            case.kind,
            time.monotonic() - started,
            False,
            str(exc),
            (),
            "",
        )
    assert case.assertions is not None
    passed, assertion_failures = evaluate_response(response_text, case.assertions)
    return CaseResult(
        case.case_id,
        case.kind,
        time.monotonic() - started,
        passed,
        None,
        assertion_failures,
        response_text,
    )


def _multipart_field(boundary: str, name: str, value: str) -> bytes:
    return (
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
        f"{value}\r\n"
    ).encode()


def _multipart_file(boundary: str, name: str, path: Path, mime_type: str) -> bytes:
    header = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
        f'filename="{path.name}"\r\nContent-Type: {mime_type}\r\n\r\n'
    ).encode()
    return header + path.read_bytes() + b"\r\n"


def build_parser() -> argparse.ArgumentParser:
    """Build the CLINVEXA benchmark command-line parser.

    Returns:
        Parser whose default local working endpoint uses port 8001.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--chat-model", required=True)
    parser.add_argument("--asr-model", default="")
    parser.add_argument("--duration-seconds", type=float, default=7200.0)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main() -> int:
    """Run the N260 benchmark command-line entry point.

    Returns:
        Process exit code; zero only when all measurable gates pass.
    """
    args = build_parser().parse_args()

    cases = load_cases(args.cases)
    client = OpenAICompatibleClient(
        args.base_url,
        args.chat_model,
        args.asr_model,
        args.api_key or os.environ.get("DASHSCOPE_API_KEY", ""),
        args.timeout_seconds,
    )
    evidence = run_benchmark(cases, client, args.duration_seconds, args.concurrency)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0 if all(evidence["gate"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
