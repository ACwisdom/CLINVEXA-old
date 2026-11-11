#!/usr/bin/env python3
"""CLINVEXA remote N260 Qwen acceptance suite.

The suite intentionally uses synthetic, de-identified medical text. It stores
raw request outcomes and computed metrics so the accompanying report can be
audited and re-run without embedding credentials.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


DEFAULT_BASE_URL = "http://172.16.0.105:8818/v1"
DEFAULT_MODEL = "/workspace/model"


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return round(ordered[low], 3)
    value = ordered[low] * (high - rank) + ordered[high] * (rank - low)
    return round(value, 3)


def normalize_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"[\s，。；：、,:;.!！？?\-_/（）()\[\]{}]+", "", text).lower()


def parse_json_content(content: str | None) -> Any:
    if not content:
        raise ValueError("empty content")
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


class Client:
    def __init__(self, base_url: str, model: str, timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def models(self) -> dict[str, Any]:
        started = time.perf_counter()
        response = requests.get(f"{self.base_url}/models", timeout=20)
        elapsed = time.perf_counter() - started
        response.raise_for_status()
        return {"latency_s": round(elapsed, 3), "status": response.status_code, "body": response.json()}

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 768,
        thinking: bool = False,
        tools: list[dict[str, Any]] | None = None,
        response_format: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": thinking},
        }
        if tools is not None:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if response_format is not None:
            payload["response_format"] = response_format
        started = time.perf_counter()
        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            elapsed = time.perf_counter() - started
            return {
                "latency_s": round(elapsed, 3),
                "status": None,
                "request": payload,
                "error": f"{type(exc).__name__}: {exc}",
            }
        elapsed = time.perf_counter() - started
        result: dict[str, Any] = {
            "latency_s": round(elapsed, 3),
            "status": response.status_code,
            "request": payload,
        }
        try:
            result["body"] = response.json()
        except ValueError:
            result["body_text"] = response.text[:4000]
        if response.status_code >= 400:
            result["error"] = f"HTTP {response.status_code}"
        return result

    def stream(self, prompt: str) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": 128,
            "stream": True,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        started = time.perf_counter()
        first_chunk_s: float | None = None
        chunks: list[dict[str, Any]] = []
        done = False
        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                timeout=self.timeout,
                stream=True,
            )
        except requests.RequestException as exc:
            return {
                "status": None,
                "ttft_s": None,
                "latency_s": round(time.perf_counter() - started, 3),
                "chunk_count": 0,
                "done": False,
                "content": "",
                "chunks": [],
                "request": payload,
                "error": f"{type(exc).__name__}: {exc}",
            }
        for raw in response.iter_lines(decode_unicode=True):
            if not raw:
                continue
            if first_chunk_s is None:
                first_chunk_s = time.perf_counter() - started
            if raw.strip() == "data: [DONE]":
                done = True
                continue
            if raw.startswith("data: "):
                try:
                    chunks.append(json.loads(raw[6:]))
                except json.JSONDecodeError:
                    chunks.append({"unparsed": raw[:1000]})
        total_s = time.perf_counter() - started
        content_parts: list[str] = []
        for chunk in chunks:
            try:
                value = chunk["choices"][0]["delta"].get("content")
            except (KeyError, IndexError, TypeError):
                value = None
            if value:
                content_parts.append(value)
        return {
            "status": response.status_code,
            "ttft_s": round(first_chunk_s, 3) if first_chunk_s is not None else None,
            "latency_s": round(total_s, 3),
            "chunk_count": len(chunks),
            "done": done,
            "content": "".join(content_parts),
            "chunks": chunks,
            "request": payload,
        }


def message(result: dict[str, Any]) -> dict[str, Any]:
    try:
        return result["body"]["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return {}


def run_suite(client: Client) -> dict[str, Any]:
    evidence: dict[str, Any] = {"started_at": datetime.now().astimezone().isoformat()}
    evidence["model_discovery"] = client.models()

    # An actual over-8K request confirms whether the advertised context is only
    # metadata or an enforced runtime limit. The repeated text is synthetic.
    long_prompt = ("病历内容。" * 10000) + "\n只回复：长上下文正常"
    long_result = client.chat([{"role": "user", "content": long_prompt}], max_tokens=64, thinking=False)
    long_actual = message(long_result).get("content")
    long_result["request"]["messages"][0]["content"] = f"<synthetic repeated text; chars={len(long_prompt)}>"
    long_result["actual"] = long_actual
    long_result["passed"] = long_result.get("status") == 200 and normalize_text(long_actual) == normalize_text("长上下文正常")
    evidence["long_context_runtime"] = long_result

    instruction_cases = [
        ("算式 37+58，只输出阿拉伯数字结果。", "95"),
        ("把『患者無藥物過敏史』转为简体中文，只输出转换结果。", "患者无药物过敏史"),
        ("将 3、1、2 升序排列，只输出：1,2,3", "1,2,3"),
        ("从『就诊日期为2026年8月18日』提取日期，只输出 YYYY-MM-DD。", "2026-08-18"),
        ("『青霉素过敏』应归入哪个病历字段？只输出字段名。", "过敏史"),
        ("材料没有提到药物过敏。只输出：未提及", "未提及"),
        ("原样输出引号内内容：『主诉：咳嗽3天』", "主诉：咳嗽3天"),
        ("只输出简体中文四个字：需要复核", "需要复核"),
    ]
    instruction_results = []
    for prompt, expected in instruction_cases:
        result = client.chat([{"role": "user", "content": prompt}], max_tokens=256, thinking=False)
        content = message(result).get("content")
        result["expected"] = expected
        result["actual"] = content
        result["passed"] = normalize_text(content) == normalize_text(expected)
        instruction_results.append(result)
    evidence["instruction_following"] = instruction_results

    medical_cases = [
        {
            "text": "患者张明，男，45岁。咳嗽3天，伴低热1天。既往高血压5年。青霉素过敏。现服氨氯地平5mg每日一次。体温37.8℃。初步考虑急性上呼吸道感染。",
            "expected": {"姓名": "张明", "性别": "男", "年龄": "45", "主诉": "咳嗽3天", "既往史": "高血压", "过敏史": "青霉素", "用药史": "氨氯地平", "检查检验": "37.8", "初步判断": "急性上呼吸道感染"},
        },
        {
            "text": "李梅，女，32岁。反复上腹痛2周，进食油腻后加重。既往胆囊结石。否认药物过敏。未长期服药。腹部彩超示胆囊内多个强回声，最大约8mm。初步判断胆囊结石相关疼痛。",
            "expected": {"姓名": "李梅", "性别": "女", "年龄": "32", "主诉": "上腹痛2周", "既往史": "胆囊结石", "过敏史": "否认药物过敏", "用药史": "未长期服药", "检查检验": "8mm", "初步判断": "胆囊结石相关疼痛"},
        },
        {
            "text": "王强，男，67岁。胸闷2小时。糖尿病10年。对磺胺类药物过敏。服用二甲双胍。心电图提示ST段压低。考虑急性冠脉综合征待排。",
            "expected": {"姓名": "王强", "性别": "男", "年龄": "67", "主诉": "胸闷2小时", "既往史": "糖尿病", "过敏史": "磺胺", "用药史": "二甲双胍", "检查检验": "ST段压低", "初步判断": "急性冠脉综合征待排"},
        },
        {
            "text": "赵敏，女，28岁。发热咽痛1天。无特殊既往史。无药物过敏。尚未用药。查体咽部充血。初步考虑急性咽炎。",
            "expected": {"姓名": "赵敏", "性别": "女", "年龄": "28", "主诉": "发热咽痛1天", "既往史": "无特殊", "过敏史": "无药物过敏", "用药史": "尚未用药", "检查检验": "咽部充血", "初步判断": "急性咽炎"},
        },
        {
            "text": "陈浩，男，54岁。头晕1周。既往史未提及。阿司匹林过敏。正在口服倍他司汀。血压160/100mmHg。初步判断高血压待评估。",
            "expected": {"姓名": "陈浩", "性别": "男", "年龄": "54", "主诉": "头晕1周", "既往史": "未提及", "过敏史": "阿司匹林", "用药史": "倍他司汀", "检查检验": "160/100", "初步判断": "高血压待评估"},
        },
    ]
    medical_results = []
    medical_prompt = (
        "你是病历结构化引擎。只输出一个合法 JSON 对象，不得添加解释。"
        "固定键为：姓名、性别、年龄、主诉、既往史、过敏史、用药史、检查检验、初步判断。"
        "不得推测；未提及写‘未提及’。材料："
    )
    for case in medical_cases:
        result = client.chat(
            [{"role": "user", "content": medical_prompt + case["text"]}],
            max_tokens=768,
            thinking=False,
            response_format={"type": "json_object"},
        )
        content = message(result).get("content")
        parsed: dict[str, Any] = {}
        parse_error = None
        try:
            candidate = parse_json_content(content)
            if isinstance(candidate, dict):
                parsed = candidate
            else:
                parse_error = "JSON root is not an object"
        except Exception as exc:  # evidence capture, not control flow
            parse_error = str(exc)
        fields = {}
        for key, expected in case["expected"].items():
            actual = parsed.get(key)
            fields[key] = {
                "expected_keyword": expected,
                "actual": actual,
                "passed": normalize_text(expected) in normalize_text(actual),
            }
        result.update({"source": case["text"], "expected": case["expected"], "parsed": parsed, "parse_error": parse_error, "fields": fields})
        medical_results.append(result)
    evidence["medical_extraction"] = medical_results

    # Reuse the repository's established 20-case CLINVEXA synthetic set.
    # The legacy runner appends a system message after the user message, which
    # this Qwen chat template rejects. Here the same contract is merged into
    # the leading system message; the case content and assertions are unchanged.
    repository_root = Path(__file__).resolve().parents[2]
    case_path = repository_root / "benchmarks" / "n260" / "clinvexa-synthetic-cases.jsonl"
    established_results = []
    for raw_line in case_path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        case = json.loads(raw_line)
        expected = case["expected"]
        required = expected.get("must_contain", [])
        contract = (
            "\n输出契约：最终JSON必须以有业务含义的字段名或枚举值包含以下项目："
            + json.dumps(required, ensure_ascii=False)
            + "。不得只把这些项目复制到测试数组中；缺少来源值时使用null、空数组或明确的未提及状态。"
            "不得生成输入中不存在的患者标识、时间、诊断、治疗或证据。"
        )
        messages = [dict(item) for item in case["messages"]]
        if messages and messages[0].get("role") == "system":
            messages[0]["content"] = str(messages[0].get("content", "")) + contract
        else:
            messages.insert(0, {"role": "system", "content": contract.lstrip()})
        result = client.chat(
            messages,
            max_tokens=1024,
            thinking=False,
            response_format={"type": "json_object"} if expected.get("require_json_object") else None,
        )
        content = message(result).get("content") or ""
        normalized = content.casefold()
        failures = []
        for required_value in expected.get("must_contain", []):
            if str(required_value).casefold() not in normalized:
                failures.append(f"missing required content: {required_value}")
        for forbidden_value in expected.get("must_not_contain", []):
            if str(forbidden_value).casefold() in normalized:
                failures.append(f"forbidden content present: {forbidden_value}")
        json_error = None
        if expected.get("require_json_object"):
            try:
                if not isinstance(parse_json_content(content), dict):
                    failures.append("response is not a JSON object")
            except Exception as exc:
                json_error = str(exc)
                failures.append("response is not a JSON object")
        result.update(
            {
                "case_id": case["case_id"],
                "feature": case["feature"],
                "kind": case["kind"],
                "synthetic": case["synthetic"],
                "assertion_failures": failures,
                "json_error": json_error,
                "actual": content,
                "passed": result.get("status") == 200 and not failures,
            }
        )
        established_results.append(result)
    evidence["established_20_case_benchmark"] = established_results

    schema_prompts = [
        "输出JSON：字段 status=ok，count=1。只输出JSON。",
        "输出JSON：字段 requires_human_review=true，reason=过敏史冲突。只输出JSON。",
        "输出JSON：字段 patient_id=P-003，risk_level=medium。只输出JSON。",
        "输出JSON：字段 items 为数组，内容依次是主诉、现病史。只输出JSON。",
        "输出JSON：字段 date=2026-08-18，language=简体中文。只输出JSON。",
    ]
    schema_results = []
    for prompt in schema_prompts:
        result = client.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=384,
            thinking=False,
            response_format={"type": "json_object"},
        )
        content = message(result).get("content")
        try:
            parsed = parse_json_content(content)
            passed = isinstance(parsed, dict)
            error = None
        except Exception as exc:
            parsed = None
            passed = False
            error = str(exc)
        result.update({"actual": content, "parsed": parsed, "parse_error": error, "passed": passed})
        schema_results.append(result)
    evidence["structured_output"] = schema_results

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_patient_summary",
                "description": "读取指定患者摘要",
                "parameters": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}, "include_labs": {"type": "boolean"}},
                    "required": ["patient_id", "include_labs"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_medical_record_draft",
                "description": "根据指定来源创建病历草稿",
                "parameters": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}, "source": {"type": "string"}},
                    "required": ["patient_id", "source"],
                },
            },
        },
    ]
    tool_cases = [
        ("查询患者P-001摘要并包含检验结果。", "get_patient_summary", {"patient_id": "P-001", "include_labs": True}),
        ("查询患者P-008摘要，不包含检验结果。", "get_patient_summary", {"patient_id": "P-008", "include_labs": False}),
        ("基于问诊录音为P-003创建病历草稿。", "create_medical_record_draft", {"patient_id": "P-003", "source": "问诊录音"}),
        ("请读取P-021的患者摘要，需要同时读取检验。", "get_patient_summary", {"patient_id": "P-021", "include_labs": True}),
        ("使用门诊记录为P-099创建病历草稿。", "create_medical_record_draft", {"patient_id": "P-099", "source": "门诊记录"}),
    ]
    tool_results = []
    for prompt, expected_name, expected_args in tool_cases:
        result = client.chat([{"role": "user", "content": prompt}], max_tokens=768, thinking=False, tools=tools)
        calls = message(result).get("tool_calls") or []
        actual_name = None
        actual_args: dict[str, Any] = {}
        args_error = None
        if calls:
            call = calls[0]
            actual_name = (call.get("function") or {}).get("name")
            raw_args = (call.get("function") or {}).get("arguments") or "{}"
            try:
                actual_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception as exc:
                args_error = str(exc)
        passed = actual_name == expected_name and all(actual_args.get(k) == v for k, v in expected_args.items())
        result.update({
            "expected_name": expected_name,
            "expected_args": expected_args,
            "actual_name": actual_name,
            "actual_args": actual_args,
            "args_error": args_error,
            "passed": passed,
        })
        tool_results.append(result)
    evidence["tool_calling"] = tool_results

    stream_results = []
    for i in range(5):
        result = client.stream(f"这是第{i + 1}次流式测试。只回复：流式正常")
        result["passed"] = result["status"] == 200 and result["done"] and result["chunk_count"] > 1 and normalize_text(result["content"]) == normalize_text("流式正常")
        stream_results.append(result)
    evidence["streaming"] = stream_results

    reasoning_results = []
    for prompt in ["计算17乘以6，并给出最终答案。", "判断38.5摄氏度是否属于发热，并简短回答。", "将咳嗽3天概括为主诉。"]:
        result = client.chat([{"role": "user", "content": prompt}], max_tokens=1536, thinking=True)
        msg = message(result)
        content = msg.get("content")
        reasoning = msg.get("reasoning") or msg.get("reasoning_content")
        result.update({
            "content": content,
            "reasoning_value": reasoning,
            "passed": bool(content) and bool(reasoning) and "<think>" not in str(content).lower(),
        })
        reasoning_results.append(result)
    evidence["reasoning_separation"] = reasoning_results

    def stability_call(index: int) -> dict[str, Any]:
        result = client.chat([{"role": "user", "content": "只回复：STABLE_OK"}], max_tokens=128, thinking=False)
        actual = message(result).get("content")
        result.update({"iteration": index, "actual": actual, "passed": normalize_text(actual) == normalize_text("STABLE_OK")})
        return result

    stability_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(stability_call, i + 1) for i in range(12)]
        for future in as_completed(futures):
            stability_results.append(future.result())
    stability_results.sort(key=lambda item: item["iteration"])
    evidence["concurrent_stability"] = stability_results

    evidence["finished_at"] = datetime.now().astimezone().isoformat()
    return evidence


def summarize(evidence: dict[str, Any]) -> dict[str, Any]:
    model_rows = evidence["model_discovery"]["body"].get("data", [])
    matching = next((row for row in model_rows if row.get("id") == DEFAULT_MODEL), model_rows[0] if model_rows else {})
    context = matching.get("max_model_len")

    def pass_rate(section: str) -> tuple[int, int, float]:
        rows = evidence[section]
        passed = sum(bool(row.get("passed")) for row in rows)
        total = len(rows)
        return passed, total, round(passed / total * 100, 2) if total else 0.0

    instruction = pass_rate("instruction_following")
    schema = pass_rate("structured_output")
    tools = pass_rate("tool_calling")
    streams = pass_rate("streaming")
    reasoning = pass_rate("reasoning_separation")
    stability = pass_rate("concurrent_stability")
    established = pass_rate("established_20_case_benchmark")

    medical_rows = evidence["medical_extraction"]
    medical_fields = [field for row in medical_rows for field in row["fields"].values()]
    medical_pass = sum(field["passed"] for field in medical_fields)
    medical_total = len(medical_fields)
    medical_rate = round(medical_pass / medical_total * 100, 2) if medical_total else 0.0
    medical_json = sum(row.get("parse_error") is None for row in medical_rows)

    all_nonstream = []
    for section in ["instruction_following", "medical_extraction", "established_20_case_benchmark", "structured_output", "tool_calling", "reasoning_separation", "concurrent_stability"]:
        all_nonstream.extend(evidence[section])
    latency_values = [row["latency_s"] for row in all_nonstream if isinstance(row.get("latency_s"), (int, float))]
    ttft_values = [row["ttft_s"] for row in evidence["streaming"] if isinstance(row.get("ttft_s"), (int, float))]
    stream_latency = [row["latency_s"] for row in evidence["streaming"] if isinstance(row.get("latency_s"), (int, float))]

    return {
        "model": matching.get("id"),
        "advertised_context_tokens": context,
        "clinvexa_context_minimum_tokens": 64000,
        "context_gate_passed": isinstance(context, (int, float)) and context >= 64000,
        "long_context_runtime": {
            "status": evidence["long_context_runtime"].get("status"),
            "passed": evidence["long_context_runtime"].get("passed"),
            "error": evidence["long_context_runtime"].get("body") or evidence["long_context_runtime"].get("body_text"),
        },
        "instruction_following": {"passed": instruction[0], "total": instruction[1], "accuracy_pct": instruction[2]},
        "medical_field_extraction": {"passed_fields": medical_pass, "total_fields": medical_total, "accuracy_pct": medical_rate, "json_success": medical_json, "cases": len(medical_rows)},
        "established_20_case_benchmark": {"passed": established[0], "total": established[1], "accuracy_pct": established[2]},
        "structured_output": {"passed": schema[0], "total": schema[1], "success_pct": schema[2]},
        "tool_calling": {"passed": tools[0], "total": tools[1], "accuracy_pct": tools[2]},
        "streaming": {"passed": streams[0], "total": streams[1], "success_pct": streams[2]},
        "reasoning_separation": {"passed": reasoning[0], "total": reasoning[1], "success_pct": reasoning[2]},
        "concurrent_stability": {"passed": stability[0], "total": stability[1], "success_pct": stability[2], "concurrency": 3},
        "latency": {
            "nonstream_samples": len(latency_values),
            "nonstream_p50_s": percentile(latency_values, 0.50),
            "nonstream_p95_s": percentile(latency_values, 0.95),
            "stream_ttft_p50_s": percentile(ttft_values, 0.50),
            "stream_ttft_p95_s": percentile(ttft_values, 0.95),
            "stream_total_p50_s": percentile(stream_latency, 0.50),
            "stream_total_p95_s": percentile(stream_latency, 0.95),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    client = Client(args.base_url, args.model)
    evidence = run_suite(client)
    evidence["summary"] = summarize(evidence)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
