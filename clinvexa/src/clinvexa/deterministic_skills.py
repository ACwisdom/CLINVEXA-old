"""Deterministic execution for CLINVEXA's core medical-document Skills.

These runners deliberately avoid an LLM. They preserve source wording, map only
explicitly labelled facts, mark missing data for doctor review, and always write
the fixed deliverable required by the selected Skill.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Literal
from uuid import uuid4
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


DeterministicSkillName = Literal["record-structuring", "outpatient-note-draft", "followup-plan"]
DETERMINISTIC_SKILLS = frozenset({"record-structuring", "outpatient-note-draft", "followup-plan"})
SUPPORTED_SOURCE_EXTENSIONS = frozenset({".txt", ".md", ".csv", ".json", ".log", ".docx", ".xlsx", ".pdf"})
DISCLAIMER = "本结果仅用于信息辅助和人工审核，不作为临床诊断、处方或治疗决策依据。"
MISSING = "原文未涉及，待医生补充"
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
LABEL_RE = re.compile(r"^\s*([^：:\n]{1,18})\s*[：:]\s*(.*?)\s*$")
LIST_PREFIX_RE = re.compile(r"^\s*(?:[-•]|\d+[.、]|[一二三四五六七八九十]+[、.])\s*")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；])\s*")

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "patient_id": ("患者编号", "病历号", "门诊号", "住院号"),
    "patient_name": ("患者姓名", "姓名", "患者"),
    "sex": ("性别",),
    "age": ("年龄",),
    "encounter_date": ("就诊日期", "就诊时间", "日期"),
    "chief_complaint": ("主诉",),
    "history_of_present_illness": ("现病史", "现病情况"),
    "past_medical_history": ("既往史", "既往病史"),
    "family_history": ("家族史",),
    "allergy_history": ("过敏史", "药物过敏史"),
    "medication_history": ("用药史", "当前用药", "现用药物"),
    "physical_examination": ("查体", "体格检查"),
    "examination_results": ("检查检验信息", "检查摘要", "检查结果", "检验结果", "辅助检查"),
    "initial_assessment": ("初步判断", "初步诊断", "诊断"),
    "treatment_plan": ("处置建议", "处置计划", "处理意见", "治疗计划"),
    "follow_up_plan": ("随访计划", "复诊计划", "随访"),
    "follow_up_time": ("随访时间", "复诊时间"),
    "follow_up_method": ("随访方式",),
    "observation_items": ("观察项目", "观察指标"),
    "recheck_items": ("复查项目", "复查事项"),
    "trigger_conditions": ("异常触发条件", "就医触发条件"),
    "patient_constraints": ("患者限制", "联系限制", "随访限制"),
}

SECTION_FIELDS: dict[str, str] = {
    "医生初步判断": "initial_assessment",
    "初步判断": "initial_assessment",
    "本次处置": "treatment_plan",
    "处置": "treatment_plan",
    "医生明确的随访要求": "follow_up_plan",
    "随访要求": "follow_up_plan",
    "患者限制": "patient_constraints",
}

FIELD_LABELS: dict[str, str] = {
    "chief_complaint": "主诉", "history_of_present_illness": "现病史",
    "past_medical_history": "既往史", "allergy_history": "过敏史",
    "medication_history": "用药史", "examination_results": "检查检验信息",
    "initial_assessment": "初步判断", "treatment_plan": "处置建议",
    "follow_up_plan": "随访计划", "follow_up_time": "建议时间",
    "follow_up_method": "随访方式", "observation_items": "观察项目",
    "recheck_items": "复查项目", "trigger_conditions": "异常触发条件",
    "patient_constraints": "患者限制",
}

DIALOGUE_QUESTION_FIELDS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(主要哪里不舒服|哪里不舒服|什么不舒服|怎么不舒服|怎么了)"), "chief_complaint"),
    (re.compile(r"(持续多久|什么时候开始|每次.*多久|什么情况下|有没有发热|有没有.*黄|尿色|类似情况)"), "history_of_present_illness"),
    (re.compile(r"(以前得过什么病|做过手术|既往|病史)"), "past_medical_history"),
    (re.compile(r"(过敏|不良反应)"), "allergy_history"),
    (re.compile(r"(长期吃什么药|现在.*用药|吃过什么药|服用.*药)"), "medication_history"),
    (re.compile(r"(做检查|检查了吗|报告怎么写|检查结果|检验结果|彩超|CT|核磁|血常规)"), "examination_results"),
)


class DeterministicSkillError(RuntimeError):
    """A source or deterministic deliverable could not be processed safely."""


@dataclass(frozen=True, slots=True)
class SkillExecutionResult:
    """Stable response returned to the desktop without another model call."""

    name: str
    output_paths: tuple[Path, ...]
    processed_sources: int
    result_markdown: str
    extraction_summary: dict[str, object]
    requires_human_review: bool = True


ProgressCallback = Callable[[dict[str, object]], None]


def _report(
    callback: ProgressCallback | None,
    event_id: str,
    stage: str,
    status: Literal["running", "complete"],
    message: str,
) -> None:
    if callback:
        callback(
            {
                "event_id": event_id,
                "message": message,
                "stage": stage,
                "status": status,
                "type": "progress",
            }
        )


def _decode_text(data: bytes, source: Path) -> str:
    if not data:
        raise DeterministicSkillError(f"来源文件为空：{source}")
    if b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise DeterministicSkillError(f"来源文件不是可读取的文本：{source}")
    encodings = ("utf-8-sig", "utf-16", "gb18030")
    for encoding in encodings:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if text.strip():
            return text.replace("\r\n", "\n").replace("\r", "\n")
    raise DeterministicSkillError(f"无法识别文本编码：{source}")


def _read_source(source: Path) -> str:
    source = source.expanduser().resolve()
    if not source.is_file():
        raise DeterministicSkillError(f"来源文件不存在：{source}")
    suffix = source.suffix.lower()
    if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
        return _decode_text(source.read_bytes(), source)
    if suffix in {".docx", ".xlsx"}:
        try:
            from tools.read_extract import extract_document_text
        except ImportError as exc:
            raise DeterministicSkillError("CLINVEXA 文档读取组件未加载") from exc
        try:
            return extract_document_text(str(source))
        except Exception as exc:
            raise DeterministicSkillError(f"文档读取失败：{source.name}：{exc}") from exc
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise DeterministicSkillError("PDF 读取组件未安装，无法确定性处理该文件") from exc
        try:
            text = "\n".join(page.extract_text() or "" for page in PdfReader(str(source)).pages)
        except Exception as exc:
            raise DeterministicSkillError(f"PDF 读取失败：{source.name}：{exc}") from exc
        if not text.strip():
            raise DeterministicSkillError(f"PDF 未提取到文本（扫描件需先 OCR）：{source.name}")
        return text
    raise DeterministicSkillError(f"暂不支持该文件类型：{source.suffix or '无扩展名'}")


def _resolve_input(value: str | Path) -> Path:
    raw = str(value).strip().strip('"\'')
    candidate = Path(raw).expanduser()
    if candidate.exists():
        return candidate.resolve()
    normalized = raw.replace("\\", "/")
    if normalized.startswith(".hermes/"):
        try:
            from hermes_constants import get_hermes_home
        except ImportError:
            pass
        else:
            mapped = get_hermes_home().parent / Path(normalized)
            if mapped.exists():
                return mapped.resolve()
    return candidate.resolve()


def _expand_sources(values: Iterable[str | Path]) -> tuple[list[Path], Path]:
    inputs = [_resolve_input(value) for value in values]
    if not inputs:
        raise DeterministicSkillError("请先在主对话框中导入需要处理的文件或文件夹")
    sources: list[Path] = []
    generated_markers = ("_病历结构化", "_门诊病历草稿", "_随访计划草稿")
    for item in inputs:
        if item.is_file():
            if item.suffix.lower() not in SUPPORTED_SOURCE_EXTENSIONS:
                raise DeterministicSkillError(f"暂不支持该文件类型：{item.suffix or '无扩展名'}")
            sources.append(item)
            continue
        if item.is_dir():
            sources.extend(
                path.resolve()
                for path in sorted(item.rglob("*"))
                if path.is_file()
                and path.suffix.lower() in SUPPORTED_SOURCE_EXTENSIONS
                and not any(marker in path.stem for marker in generated_markers)
            )
            continue
        raise DeterministicSkillError(f"来源路径不存在：{item}")
    sources = list(dict.fromkeys(sources))
    if not sources:
        raise DeterministicSkillError("导入的文件夹中没有可处理的医疗文档")
    return sources, inputs[0]


def _field_for_label(label: str) -> str | None:
    normalized = re.sub(r"\s+", "", label).strip("【】[]")
    for field, aliases in FIELD_ALIASES.items():
        if normalized in aliases:
            return field
    return None


def _extract_explicit_fields(text: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    values: dict[str, list[str]] = {}
    evidence: dict[str, list[str]] = {}
    current_field: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            current_field = None
            continue
        match = LABEL_RE.match(line)
        if match and (field := _field_for_label(match.group(1))):
            current_field = field
            value = match.group(2).strip()
            if value:
                values.setdefault(field, []).append(value)
                evidence.setdefault(field, []).append(line)
            continue
        if current_field and not LABEL_RE.match(line):
            values.setdefault(current_field, []).append(line)
            evidence.setdefault(current_field, []).append(line)
    return ({key: "；".join(dict.fromkeys(parts)) for key, parts in values.items()}, evidence)


def _append_fact(
    values: dict[str, list[str]], evidence: dict[str, list[str]], field: str, value: str, source_line: str
) -> None:
    cleaned = LIST_PREFIX_RE.sub("", value.strip()).strip().rstrip("，,；;")
    if not cleaned:
        return
    values.setdefault(field, []).append(cleaned)
    evidence.setdefault(field, []).append(source_line.strip())


def _merge_field_maps(
    base_values: dict[str, str],
    base_evidence: dict[str, list[str]],
    extra_values: dict[str, list[str]],
    extra_evidence: dict[str, list[str]],
) -> tuple[dict[str, str], dict[str, list[str]]]:
    merged: dict[str, list[str]] = {
        key: [part for part in value.split("；") if part]
        for key, value in base_values.items()
    }
    for key, parts in extra_values.items():
        merged.setdefault(key, []).extend(parts)
    evidence = {key: list(parts) for key, parts in base_evidence.items()}
    for key, parts in extra_evidence.items():
        evidence.setdefault(key, []).extend(parts)
    return (
        {key: "；".join(dict.fromkeys(part.strip() for part in parts if part.strip())) for key, parts in merged.items()},
        {key: list(dict.fromkeys(part for part in parts if part)) for key, parts in evidence.items()},
    )


def _extract_section_fields(text: str) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    values: dict[str, list[str]] = {}
    evidence: dict[str, list[str]] = {}
    active: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = LABEL_RE.match(line)
        if match:
            label, inline = match.groups()
            normalized = re.sub(r"\s+", "", label)
            if normalized in SECTION_FIELDS:
                active = SECTION_FIELDS[normalized]
                if inline.strip():
                    _append_fact(values, evidence, active, inline, line)
                continue
            if _field_for_label(label):
                active = None
                continue
            if len(label) <= 18 and not inline.strip():
                active = None
                continue
        if active:
            _append_fact(values, evidence, active, line, line)
    return values, evidence


def _dialogue_field_for_question(question: str) -> str | None:
    for pattern, field in DIALOGUE_QUESTION_FIELDS:
        if pattern.search(question):
            return field
    return None


def _extract_dialogue_fields(text: str) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    values: dict[str, list[str]] = {}
    evidence: dict[str, list[str]] = {}
    pending_question = ""
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if line.startswith("医生："):
            doctor_text = line.split("：", 1)[1].strip()
            if doctor_text.endswith(("？", "?")):
                pending_question = doctor_text
            else:
                joined = doctor_text
                while index + 1 < len(lines):
                    probe = lines[index + 1].strip()
                    if not probe or LABEL_RE.match(probe):
                        break
                    index += 1
                    joined += probe
                clauses = [item for item in SENTENCE_SPLIT_RE.split(joined) if item]
                for clause in clauses:
                    if re.search(r"(考虑|判断|诊断|待排)", clause):
                        _append_fact(values, evidence, "initial_assessment", clause, joined)
                    else:
                        conditional = re.match(r"^(.*?)(如果.+)$", clause)
                        treatment, followup = conditional.groups() if conditional else (clause, "")
                        if re.search(r"(暂时|建议|需要|避免|饮食|休息|用药)", treatment):
                            _append_fact(values, evidence, "treatment_plan", treatment, joined)
                        if followup or re.search(r"(复诊|随访|就医)", clause):
                            _append_fact(values, evidence, "follow_up_plan", followup or clause, joined)
        elif line.startswith("患者："):
            answer = line.split("：", 1)[1].strip()
            while index + 1 < len(lines):
                probe = lines[index + 1].strip()
                if not probe or LABEL_RE.match(probe):
                    break
                index += 1
                answer += probe
            field = _dialogue_field_for_question(pending_question)
            if field:
                _append_fact(values, evidence, field, answer, f"医生：{pending_question} | {line}")
            pending_question = ""
        index += 1
    return values, evidence


def _extract_medical_fields(text: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    values, evidence = _extract_explicit_fields(text)
    for extractor in (_extract_section_fields, _extract_dialogue_fields):
        extra_values, extra_evidence = extractor(text)
        values, evidence = _merge_field_maps(values, evidence, extra_values, extra_evidence)

    # Common deterministic facts in narrative clinical summaries.
    narrative_values: dict[str, list[str]] = {}
    narrative_evidence: dict[str, list[str]] = {}
    for raw_line in text.splitlines():
        line = LIST_PREFIX_RE.sub("", raw_line.strip()).strip()
        if not line or LABEL_RE.match(line) or line.startswith(("医生：", "患者：")):
            continue
        if (match := re.search(r"患者因[“\"]?(.+?)[”\"]?就诊", line)):
            _append_fact(narrative_values, narrative_evidence, "chief_complaint", match.group(1), raw_line)
        if re.search(r"(体温|心率|呼吸|血氧|血压|血常规|反应蛋白|彩超|CT|核磁|报告(?:提示|显示|写))", line):
            _append_fact(narrative_values, narrative_evidence, "examination_results", line, raw_line)
    return _merge_field_maps(values, evidence, narrative_values, narrative_evidence)


def _status(value: str | None) -> str:
    if not value:
        return "not_mentioned"
    if re.search(r"(否认|无|未见|没有)", value):
        return "absent"
    if re.search(r"(考虑|疑似|可能|待排|待查)", value):
        return "suspected"
    return "present"


def _record_row(source: Path, text: str) -> dict[str, object]:
    fields, evidence = _extract_medical_fields(text)
    row: dict[str, object] = {
        "来源文件": str(source.resolve()),
        "文书类型": "medical_document",
        "患者编号": fields.get("patient_id", MISSING),
        "患者姓名": fields.get("patient_name", MISSING),
        "性别": fields.get("sex", MISSING),
        "年龄": fields.get("age", MISSING),
        "就诊日期": fields.get("encounter_date", MISSING),
    }
    columns = (
        ("主诉", "chief_complaint"),
        ("现病史", "history_of_present_illness"),
        ("既往史", "past_medical_history"),
        ("家族史", "family_history"),
        ("过敏史", "allergy_history"),
        ("用药史", "medication_history"),
        ("查体", "physical_examination"),
        ("检查检验信息", "examination_results"),
        ("初步判断", "initial_assessment"),
        ("处置建议", "treatment_plan"),
        ("随访计划", "follow_up_plan"),
    )
    missing: list[str] = []
    for title, field in columns:
        value = fields.get(field)
        row[title] = value or MISSING
        row[f"{title}状态"] = _status(value)
        row[f"{title}来源证据"] = " | ".join(evidence.get(field, [])) or "原文未找到对应标签"
        if not value:
            missing.append(title)
    row["缺失字段"] = "、".join(missing)
    row["处理状态"] = "success" if fields else "needs_review"
    row["需要医生复核"] = "true"
    row["免责声明"] = DISCLAIMER
    return row


def _draft(source: Path, text: str) -> str:
    fields, evidence = _extract_medical_fields(text)
    output_fields = (
        ("主诉", "chief_complaint"),
        ("现病史", "history_of_present_illness"),
        ("既往史", "past_medical_history"),
        ("过敏史", "allergy_history"),
        ("用药史", "medication_history"),
        ("检查检验信息", "examination_results"),
        ("初步判断", "initial_assessment"),
        ("处置建议", "treatment_plan"),
        ("随访计划", "follow_up_plan"),
    )
    lines = ["CLINVEXA 门诊病历草稿", f"来源文件：{source.resolve()}"]
    missing: list[str] = []
    for title, field in output_fields:
        value = fields.get(field)
        lines.append(f"{title}：{value or '对话未涉及，待医生补充'}")
        if not value:
            missing.append(title)
    lines.extend((
        f"医生复核项：{'、'.join(missing) if missing else '请核对全部字段与来源原文'}",
        "来源证据：",
    ))
    for title, field in output_fields:
        if evidence.get(field):
            lines.append(f"- {title}：{' | '.join(evidence[field])}")
    lines.extend(("requires_human_review: true", DISCLAIMER))
    return "\n".join(lines) + "\n"


def _followup_details(fields: dict[str, str], evidence: dict[str, list[str]]) -> dict[str, str]:
    details = {
        key: fields.get(key, "")
        for key in (
            "follow_up_time",
            "follow_up_method",
            "observation_items",
            "recheck_items",
            "trigger_conditions",
        )
    }
    followup_parts = [part.strip() for part in fields.get("follow_up_plan", "").split("；") if part.strip()]
    derived_evidence: dict[str, list[str]] = {}
    for part in followup_parts:
        if not details["follow_up_time"] and (match := re.search(r"((?:\d+|[一二三四五六七八九十]+)(?:天|日|周|个月|月)后)", part)):
            details["follow_up_time"] = match.group(1)
            derived_evidence.setdefault("follow_up_time", []).append(part)
        if not details["follow_up_method"] and (match := re.search(r"(门诊复诊|电话随访|电话回访|微信随访|线上复诊|上门随访)", part)):
            details["follow_up_method"] = match.group(1)
            derived_evidence.setdefault("follow_up_method", []).append(part)
        if re.search(r"(观察|监测|留意)", part):
            details["observation_items"] = "；".join(filter(None, (details["observation_items"], part)))
            derived_evidence.setdefault("observation_items", []).append(part)
        if re.search(r"(复查|复检)", part):
            details["recheck_items"] = "；".join(filter(None, (details["recheck_items"], part)))
            derived_evidence.setdefault("recheck_items", []).append(part)
        if re.search(r"(如果|如出现|一旦|提前就医|及时就医)", part):
            details["trigger_conditions"] = "；".join(filter(None, (details["trigger_conditions"], part)))
            derived_evidence.setdefault("trigger_conditions", []).append(part)
    for key, parts in derived_evidence.items():
        evidence.setdefault(key, []).extend(parts)
    return {key: "；".join(dict.fromkeys(part for part in value.split("；") if part)) for key, value in details.items()}


def _followup_section(source: Path, text: str, index: int) -> str:
    fields, evidence = _extract_medical_fields(text)
    details = _followup_details(fields, evidence)
    patient = fields.get("patient_name") or fields.get("patient_id") or f"来源{index}"
    purpose = fields.get("initial_assessment") or fields.get("chief_complaint")
    missing_items = [
        title for title, field in (
            ("随访目的", "purpose"),
            ("建议时间", "follow_up_time"),
            ("随访方式", "follow_up_method"),
            ("观察项目", "observation_items"),
            ("复查项目", "recheck_items"),
            ("异常触发条件", "trigger_conditions"),
        ) if not (purpose if field == "purpose" else details[field])
    ]
    lines = [
        f"患者标识：{patient}",
        f"就诊日期：{fields.get('encounter_date') or '原文未涉及'}",
        f"来源文件：{source.resolve()}",
        f"当前病情摘要：{fields.get('chief_complaint') or '原文未涉及'}；{fields.get('examination_results') or '检查检验信息未涉及'}",
        f"初步判断：{fields.get('initial_assessment') or '原文未涉及'}",
        f"已记录处置：{fields.get('treatment_plan') or '原文未涉及'}",
        f"随访目的：{purpose or '待医生确定'}",
        f"建议时间：{details['follow_up_time'] or '待医生确定'}",
        f"随访方式：{details['follow_up_method'] or '待医生确定'}",
        f"观察项目：{details['observation_items'] or '待医生确定'}",
        f"复查项目：{details['recheck_items'] or '待医生确定'}",
        f"异常触发条件：{details['trigger_conditions'] or '待医生确定'}",
        f"患者相关限制：{fields.get('patient_constraints') or '原文未涉及'}",
        "执行提醒：严格按医生明确要求执行；本计划生效前须由医生复核确认",
        "来源证据：" + (" | ".join(evidence.get("follow_up_plan", [])) or "原文未找到明确随访要求"),
        "待医生确认项：" + ("、".join(missing_items) if missing_items else "待医生复核全部计划要素"),
        "requires_human_review: true",
    ]
    return "\n".join(lines)


def _output_path(anchor: Path, source_count: int, suffix: str, extension: str, explicit: Path | None) -> Path:
    if explicit:
        target = explicit.expanduser().resolve()
        return target if target.suffix.lower() == extension else target.with_suffix(extension)
    anchor = anchor.resolve()
    parent = anchor if anchor.is_dir() else anchor.parent
    stem = INVALID_FILENAME.sub("_", anchor.stem if anchor.is_file() else anchor.name).strip(" .") or "医疗资料"
    summary = "汇总" if source_count > 1 else ""
    return parent / f"{stem}_{suffix}{summary}{extension}"


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _column_name(index: int) -> str:
    result = ""
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _xlsx_cell(ref: str, value: object, style: int = 0) -> str:
    text = _cell_text(value)
    preserve = ' xml:space="preserve"' if text != text.strip() else ""
    return f'<c r="{ref}" t="inlineStr" s="{style}"><is><t{preserve}>{escape(text)}</t></is></c>'


def _replace_output(source: Path, target: Path) -> None:
    """Commit one completed result file.

    Kept as a tiny seam so the Windows file-in-use path can be regression tested
    without depending on the host's Excel/WPS locking implementation.
    """

    source.replace(target)


def _versioned_output_path(target: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    for index in range(1000):
        suffix = f"_{stamp}" if index == 0 else f"_{stamp}_{index + 1}"
        candidate = target.with_name(f"{target.stem}{suffix}{target.suffix}")
        if not candidate.exists():
            return candidate
    raise DeterministicSkillError("同目录可用结果文件名已耗尽，请整理目录后重试")


def _commit_output(temporary: Path, target: Path) -> tuple[Path, bool]:
    """Atomically commit output, preserving an open workbook instead of failing."""

    try:
        _replace_output(temporary, target)
        return target, False
    except PermissionError:
        fallback = _versioned_output_path(target)
        try:
            _replace_output(temporary, fallback)
        except OSError as exc:
            raise DeterministicSkillError(f"结果目录不可写：{fallback.parent}（{exc}）") from exc
        return fallback, True


def _write_workbook(target: Path, rows: list[dict[str, object]]) -> tuple[Path, bool]:
    if not rows:
        raise DeterministicSkillError("没有可写入的病历记录")
    headers = list(dict.fromkeys(key for row in rows for key in row))
    sheet_rows = [
        '<row r="1">' + "".join(_xlsx_cell(f"{_column_name(i)}1", header, 1) for i, header in enumerate(headers)) + "</row>"
    ]
    for row_index, row in enumerate(rows, 2):
        cells = "".join(_xlsx_cell(f"{_column_name(i)}{row_index}", row.get(header, "")) for i, header in enumerate(headers))
        sheet_rows.append(f'<row r="{row_index}">{cells}</row>')
    last = f"{_column_name(len(headers) - 1)}{len(rows) + 1}"
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<sheetData>{"".join(sheet_rows)}</sheetData><autoFilter ref="A1:{last}"/></worksheet>'
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
            archive.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
            archive.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="病历结构化结果" sheetId="1" r:id="rId1"/></sheets></workbook>')
            archive.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
            archive.writestr("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>')
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        return _commit_output(temporary, target)
    except DeterministicSkillError:
        raise
    except OSError as exc:
        raise DeterministicSkillError(f"Excel 结果生成失败：{target}（{exc}）") from exc
    finally:
        temporary.unlink(missing_ok=True)


def _record_result_markdown(rows: list[dict[str, object]], target: Path) -> str:
    preview = [
        "### 病历结构化结果",
        "",
        f"共完成 **{len(rows)}** 份病历的确定性结构化，已汇总为一个 Excel 文件。",
        "",
        "| 来源 | 患者 | 主诉 | 初步判断 | 缺失字段 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows[:20]:
        source = Path(str(row["来源文件"])).name.replace("|", "\\|")
        values = [
            source,
            str(row["患者姓名"]),
            str(row["主诉"]),
            str(row["初步判断"]),
            str(row["缺失字段"] or "无"),
        ]
        preview.append("| " + " | ".join(value.replace("|", "\\|").replace("\n", " ") for value in values) + " |")
    if len(rows) > 20:
        preview.extend(("", f"另有 {len(rows) - 20} 份记录已写入 Excel 完整结果。"))
    preview.extend(("", f"结果文件：`{target.resolve()}`", "", DISCLAIMER))
    return "\n".join(preview)


def _text_result_markdown(title: str, content: str, target: Path, source_count: int) -> str:
    display = content.strip()
    if len(display) > 12_000:
        display = display[:12_000].rstrip() + "\n\n（对话框仅展示前 12000 字，完整内容见结果文件。）"
    return "\n".join(
        (
            f"### {title}",
            "",
            f"已处理 **{source_count}** 份来源资料。",
            "",
            display,
            "",
            f"结果文件：`{target.resolve()}`",
            "",
            DISCLAIMER,
        )
    )


def _extraction_summary(name: str, documents: list[tuple[Path, str]]) -> dict[str, object]:
    summaries: list[dict[str, object]] = []
    for source, text in documents:
        fields, evidence = _extract_medical_fields(text)
        if name == "outpatient-note-draft":
            keys = (
                "chief_complaint", "history_of_present_illness", "past_medical_history",
                "allergy_history", "medication_history", "examination_results",
                "initial_assessment", "treatment_plan", "follow_up_plan",
            )
        elif name == "followup-plan":
            details = _followup_details(fields, evidence)
            fields = {**fields, **details}
            keys = (
                "initial_assessment", "treatment_plan", "follow_up_time",
                "follow_up_method", "observation_items", "recheck_items",
                "trigger_conditions", "patient_constraints",
            )
        else:
            keys = tuple(field for field in FIELD_ALIASES if field not in {"patient_constraints"})
        matched = [key for key in keys if fields.get(key)]
        missing = [key for key in keys if not fields.get(key)]
        structure = []
        if any(line.strip().startswith(("医生：", "患者：")) for line in text.splitlines()):
            structure.append("医患问答")
        if any(re.sub(r"\s+", "", match.group(1)) in SECTION_FIELDS for line in text.splitlines() if (match := LABEL_RE.match(line.strip()))):
            structure.append("标题区块")
        if evidence:
            structure.append("字段标签/原文证据")
        summaries.append(
            {
                "matched_fields": matched,
                "missing_fields": missing,
                "patient": fields.get("patient_name") or fields.get("patient_id") or "未明确",
                "source": source.name,
                "structure": list(dict.fromkeys(structure)) or ["自然段"],
            }
        )
    return {"documents": summaries}


def _summary_progress_message(summary: dict[str, object]) -> str:
    parts: list[str] = []
    for raw in summary.get("documents", []):
        if not isinstance(raw, dict):
            continue
        matched = [FIELD_LABELS.get(str(key), str(key)) for key in raw.get("matched_fields", [])]
        missing = [FIELD_LABELS.get(str(key), str(key)) for key in raw.get("missing_fields", [])]
        structures = "、".join(str(item) for item in raw.get("structure", []))
        details = f"{raw.get('source')}：识别{structures}；已提取 {len(matched)} 项（{'、'.join(matched)}）"
        if missing:
            details += f"；待补 {len(missing)} 项（{'、'.join(missing)}）"
        parts.append(details)
    return "；".join(parts)


def _missing_summary(summary: dict[str, object]) -> tuple[int, list[str]]:
    missing: list[str] = []
    for raw in summary.get("documents", []):
        if not isinstance(raw, dict):
            continue
        missing.extend(FIELD_LABELS.get(str(key), str(key)) for key in raw.get("missing_fields", []))
    return len(missing), list(dict.fromkeys(missing))


def execute_deterministic_skill(
    name: str,
    source_paths: Iterable[str | Path],
    output_path: str | Path | None = None,
    on_progress: ProgressCallback | None = None,
) -> SkillExecutionResult:
    """Run one core medical Skill without model generation or ad-hoc commands."""
    if name not in DETERMINISTIC_SKILLS:
        raise DeterministicSkillError(f"Skill 未配置确定性执行器：{name}")
    _report(on_progress, "receive", "资料接收", "running", "正在检查导入的文件或文件夹。")
    sources, anchor = _expand_sources(source_paths)
    source_names = "、".join(source.name for source in sources)
    _report(on_progress, "receive", "资料接收", "complete", f"已识别 {len(sources)} 份可处理资料：{source_names}")
    documents: list[tuple[Path, str]] = []
    for index, source in enumerate(sources, 1):
        _report(on_progress, "read", "文件读取", "running", f"正在读取第 {index}/{len(sources)} 份：{source.name}")
        documents.append((source, _read_source(source)))
    _report(on_progress, "read", "文件读取", "complete", f"已完成 {len(documents)} 份资料读取与文本编码校验：{source_names}")
    explicit = Path(output_path) if output_path else None
    extraction_summary: dict[str, object]
    _report(on_progress, "extract", "字段提取", "running", "正在按 Skill 固定字段与来源证据规则提取内容。")
    if name == "record-structuring":
        target = _output_path(anchor, len(sources), "病历结构化", ".xlsx", explicit)
        rows = [_record_row(source, text) for source, text in documents]
        extraction_summary = _extraction_summary(name, documents)
        _report(on_progress, "extract", "字段提取", "complete", _summary_progress_message(extraction_summary))
        _report(on_progress, "validate", "规则校验", "running", "正在检查缺失字段、状态标记及来源证据。")
        missing_count = sum(bool(row.get("缺失字段")) for row in rows)
        _report(on_progress, "validate", "规则校验", "complete", f"校验完成；{missing_count} 条记录存在待医生补充字段。")
        _report(on_progress, "write", "结果生成", "running", "正在生成单个汇总 Excel 文件。")
        requested_target = target
        target, rerouted = _write_workbook(target, rows)
        if rerouted:
            _report(
                on_progress,
                "write",
                "结果生成",
                "running",
                f"原结果文件正在被 Excel/WPS 使用：{requested_target.resolve()}；已保护原文件并安全另存为新结果。",
            )
        result_markdown = _record_result_markdown(rows, target)
    elif name == "outpatient-note-draft":
        target = _output_path(anchor, len(sources), "门诊病历草稿", ".txt", explicit)
        content = "\n\n".join(_draft(source, text).rstrip() for source, text in documents)
        extraction_summary = _extraction_summary(name, documents)
        _report(on_progress, "extract", "字段提取", "complete", _summary_progress_message(extraction_summary))
        _report(on_progress, "validate", "规则校验", "running", "正在标记对话未涉及字段与医生复核项。")
        missing_count, missing_labels = _missing_summary(extraction_summary)
        validation_message = (
            "九字段均已从原文独立提取并完成来源证据校验；保留医生复核标记。"
            if missing_count == 0
            else f"九字段完整性与来源证据校验完成；待医生补充 {missing_count} 项（{'、'.join(missing_labels)}）。"
        )
        _report(on_progress, "validate", "规则校验", "complete", validation_message)
        _report(on_progress, "write", "结果生成", "running", "正在生成 UTF-8 简体中文门诊病历草稿。")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content + "\n", encoding="utf-8-sig", newline="\n")
        result_markdown = _text_result_markdown("门诊病历草稿", content, target, len(sources))
    else:
        target = _output_path(anchor, len(sources), "随访计划草稿", ".txt", explicit)
        content = "\n\n".join(_followup_section(source, text, index) for index, (source, text) in enumerate(documents, 1))
        extraction_summary = _extraction_summary(name, documents)
        _report(on_progress, "extract", "字段提取", "complete", _summary_progress_message(extraction_summary))
        _report(on_progress, "validate", "规则校验", "running", "正在检查随访时间、方式、观察项及异常触发条件。")
        missing_count, missing_labels = _missing_summary(extraction_summary)
        validation_message = (
            "随访时间、方式、观察项、复查项和异常触发条件均已提取；保留医生最终确认标记。"
            if missing_count == 0
            else f"随访要素校验完成；待医生确定 {missing_count} 项（{'、'.join(missing_labels)}）。"
        )
        _report(on_progress, "validate", "规则校验", "complete", validation_message)
        _report(on_progress, "write", "结果生成", "running", "正在生成 UTF-8 简体中文随访计划草稿。")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content + f"\n\n{DISCLAIMER}\n", encoding="utf-8-sig", newline="\n")
        result_markdown = _text_result_markdown("随访计划草稿", content, target, len(sources))
    if not target.is_file() or target.stat().st_size == 0:
        raise DeterministicSkillError("交付文件生成失败")
    _report(on_progress, "write", "结果生成", "complete", f"结果文件已生成：{target.resolve()}")
    return SkillExecutionResult(
        name=name,
        output_paths=(target.resolve(),),
        processed_sources=len(sources),
        result_markdown=result_markdown,
        extraction_summary=extraction_summary,
    )


def main(argv: list[str] | None = None) -> int:
    # CLI output is consumed by the desktop as UTF-8, including Chinese paths.
    # Windows pipe defaults can otherwise emit GBK and lose the result path.
    import sys
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="CLINVEXA deterministic medical Skill runner")
    parser.add_argument("name", choices=sorted(DETERMINISTIC_SKILLS))
    parser.add_argument("--source", action="append", required=True)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        result = execute_deterministic_skill(args.name, args.source, args.output)
    except DeterministicSkillError as exc:
        parser.exit(1, f"CLINVEXA Skill 执行失败：{exc}\n")
    print(str(result.output_paths[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
