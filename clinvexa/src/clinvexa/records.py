"""Evidence-preserving CLINVEXA medical-record workflow primitives."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

NON_CLINICAL_DISCLAIMER = (
    "本结果由自动化工具从原始病历中提取和整理，仅用于信息辅助和人工审核，"
    "不作为临床诊断、处方或治疗决策依据。"
)

PatientSex = Literal["female", "male", "unknown"]
ClinicalStatus = Literal["absent", "conflict", "not_mentioned", "present", "unclear"]
DiagnosisCertainty = Literal["confirmed", "ruled_out", "suspected", "unclear"]
LaboratoryFlag = Literal["high", "low", "normal", "unclear"]
MedicationStatus = Literal["current", "stopped", "unclear"]


@dataclass(frozen=True, slots=True)
class SourceEvidence:
    """Link one extracted field to exact source text."""

    field: str
    source_text: str


@dataclass(frozen=True, slots=True)
class Diagnosis:
    """Represent a diagnosis exactly as documented with source certainty."""

    certainty: DiagnosisCertainty
    name: str
    source_text: str


@dataclass(frozen=True, slots=True)
class LaboratoryResult:
    """Represent a laboratory value without normalizing away its source units."""

    flag: LaboratoryFlag
    name: str
    source_text: str
    unit: str
    value: str


@dataclass(frozen=True, slots=True)
class Medication:
    """Represent one explicitly documented medication instruction."""

    dose: str
    frequency: str
    name: str
    route: str
    source_text: str
    status: MedicationStatus
    unit: str


@dataclass(frozen=True, slots=True)
class StructuredMedicalRecord:
    """Minimal evidence-preserving record used by CLINVEXA V1."""

    allergy_status: ClinicalStatus
    allergy_text: str | None
    chief_complaint: str | None
    diagnoses: tuple[Diagnosis, ...]
    disclaimer: str
    laboratory_results: tuple[LaboratoryResult, ...]
    laboratory_trend: str | None
    medications: tuple[Medication, ...]
    patient_sex: PatientSex
    quality_issues: tuple[str, ...]
    requires_human_review: bool
    source_evidence: tuple[SourceEvidence, ...]
    source_id: str


@dataclass(frozen=True, slots=True)
class FollowupDraft:
    """Represent a source-provided follow-up draft pending doctor review."""

    items: tuple[str, ...]
    requires_human_review: bool


@dataclass(frozen=True, slots=True)
class KnowledgeAnswer:
    """Represent a source-bound medical knowledge answer."""

    answer: str
    requires_human_review: bool
    sources: tuple[str, ...]


def structure_medical_record(source_id: str, text: str) -> StructuredMedicalRecord:
    """Extract a minimal structured record from labeled clinical text.

    Args:
        source_id: Stable source identifier.
        text: Original medical-record text.

    Returns:
        Structured facts with evidence and mandatory human review.

    Raises:
        ValueError: If the source identifier or text is empty.
    """
    if not source_id.strip() or not text.strip():
        raise ValueError("medical record source cannot be empty")

    sex_raw = _section(text, "性别")
    chief_complaint = _section(text, "主诉")
    allergy_text = _section(text, "过敏史")
    diagnosis_text = _section(text, "诊断")
    laboratory_text = _section(text, "检验")
    laboratory_trend = _section(text, "检验趋势")
    medication_text = _section(text, "用药")
    patient_sex: PatientSex = {"女": "female", "男": "male"}.get(sex_raw or "", "unknown")
    allergy_status = _allergy_status(allergy_text)
    diagnoses = tuple(_parse_diagnosis(item) for item in _split_items(diagnosis_text))
    laboratory_results = tuple(
        result for item in _split_items(laboratory_text) if (result := _parse_laboratory_result(item)) is not None
    )
    medication_items = _split_items(medication_text)
    medications = tuple(
        medication for item in medication_items if (medication := _parse_medication(item)) is not None
    )

    evidence: list[SourceEvidence] = []
    for field, value in (
        ("patient.sex", sex_raw),
        ("chief_complaint", chief_complaint),
        ("allergy_history", allergy_text),
        ("diagnoses", diagnosis_text),
        ("laboratory_results", laboratory_text),
        ("laboratory_trend", laboratory_trend),
        ("medications", medication_text),
    ):
        if value:
            evidence.append(SourceEvidence(field=field, source_text=value))

    quality_issues = [
        f"missing field: {field}"
        for field, value in (
            ("patient.sex", sex_raw),
            ("chief_complaint", chief_complaint),
            ("allergy_history", allergy_text),
            ("diagnoses", diagnosis_text),
        )
        if not value
    ]
    if allergy_status == "conflict":
        quality_issues.append("allergy conflict")
    for item in medication_items:
        if _parse_medication(item) is None:
            if re.search(r"\s\d+(?:\.\d+)?\s+(?:口服|静脉|肌注|皮下|外用)\s", item):
                quality_issues.append(f"medication unit missing: {item}")
            else:
                quality_issues.append(f"unparsed medication: {item}")
    return StructuredMedicalRecord(
        allergy_status=allergy_status,
        allergy_text=allergy_text,
        chief_complaint=chief_complaint,
        diagnoses=diagnoses,
        disclaimer=NON_CLINICAL_DISCLAIMER,
        laboratory_results=laboratory_results,
        laboratory_trend=laboratory_trend,
        medications=medications,
        patient_sex=patient_sex,
        quality_issues=tuple(quality_issues),
        requires_human_review=True,
        source_evidence=tuple(evidence),
        source_id=source_id,
    )


def build_one_page_summary(record: StructuredMedicalRecord) -> str:
    """Build a compact summary containing only extracted facts.

    Args:
        record: Structured source record.

    Returns:
        Human-readable evidence-bound summary.
    """
    diagnoses = "；".join(item.source_text for item in record.diagnoses) or "未提及"
    laboratory_results = "；".join(item.source_text for item in record.laboratory_results) or "未提及"
    medications = "；".join(item.source_text for item in record.medications) or "未提及"
    return "\n".join(
        (
            f"来源：{record.source_id}",
            f"主诉：{record.chief_complaint or '未提及'}",
            f"过敏史：{record.allergy_text or '未提及'}",
            f"诊断记录：{diagnoses}",
            f"检验：{laboratory_results}",
            f"检验趋势：{record.laboratory_trend or '未提及'}",
            f"用药：{medications}",
            NON_CLINICAL_DISCLAIMER,
        )
    )


def build_followup_draft(record: StructuredMedicalRecord, source_items: list[str]) -> FollowupDraft:
    """Create a follow-up draft only from explicitly supplied plan items.

    Args:
        record: Structured source record retained for workflow identity.
        source_items: Follow-up items explicitly present in source or entered by a doctor.

    Returns:
        Review-required follow-up draft.
    """
    _ = record
    return FollowupDraft(items=tuple(item.strip() for item in source_items if item.strip()), requires_human_review=True)


def answer_medical_knowledge(question: str, sources: list[str]) -> KnowledgeAnswer:
    """Create a source-bound knowledge response contract.

    Args:
        question: Doctor's medical knowledge question.
        sources: Retrieved source identifiers.

    Returns:
        An insufficient-evidence response when no source is available, otherwise a review-required answer contract.
    """
    normalized_sources = tuple(source.strip() for source in sources if source.strip())
    if not normalized_sources:
        return KnowledgeAnswer(answer="依据不足", requires_human_review=True, sources=())
    return KnowledgeAnswer(
        answer=f"请依据已检索来源审核问题：{question.strip()}",
        requires_human_review=True,
        sources=normalized_sources,
    )


def _section(text: str, label: str) -> str | None:
    match = re.search(rf"(?:^|\n){re.escape(label)}[：:]\s*([^\n]+)", text)
    return match.group(1).strip() if match else None


def _split_items(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in re.split(r"[；;，,]", value) if item.strip())


def _allergy_status(value: str | None) -> ClinicalStatus:
    if value is None:
        return "not_mentioned"
    if any(marker in value for marker in ("不详", "不清", "无法提供")):
        return "unclear"
    has_absent = "无药物过敏" in value or "否认过敏" in value
    remaining = value.replace("无药物过敏史", "").replace("否认过敏", "")
    if has_absent and "过敏" in remaining:
        return "conflict"
    if has_absent:
        return "absent"
    return "present"


def _parse_diagnosis(source_text: str) -> Diagnosis:
    name = source_text
    certainty: DiagnosisCertainty = "confirmed"
    for prefix in ("考虑", "疑似", "可能"):
        if name.startswith(prefix):
            name = name.removeprefix(prefix).strip()
            certainty = "suspected"
            break
    for suffix in ("待查", "待排"):
        if name.endswith(suffix):
            name = name.removesuffix(suffix).strip()
            certainty = "suspected"
    for suffix in ("已排除", "不支持"):
        if name.endswith(suffix):
            name = name.removesuffix(suffix).strip()
            certainty = "ruled_out"
    return Diagnosis(certainty=certainty, name=name, source_text=source_text)


def _parse_laboratory_result(source_text: str) -> LaboratoryResult | None:
    match = re.fullmatch(
        r"(?P<name>.+?)\s+(?P<value>-?\d+(?:\.\d+)?)\s+(?P<unit>\S+?)(?:\s+(?P<flag>↑|↓|高|低|正常))?",
        source_text,
    )
    if not match:
        return None
    flag: LaboratoryFlag = {"↑": "high", "高": "high", "↓": "low", "低": "low", "正常": "normal"}.get(
        match.group("flag") or "", "unclear"
    )
    return LaboratoryResult(
        flag=flag,
        name=match.group("name"),
        source_text=source_text,
        unit=match.group("unit"),
        value=match.group("value"),
    )


def _parse_medication(source_text: str) -> Medication | None:
    match = re.fullmatch(
        r"(?P<name>.+?)\s+(?P<dose>\d+(?:\.\d+)?)\s+(?P<unit>\S+)\s+"
        r"(?P<route>\S+)\s+(?P<frequency>\S+)\s+(?P<status>当前|已停)",
        source_text,
    )
    if not match:
        return None
    status: MedicationStatus = "current" if match.group("status") == "当前" else "stopped"
    return Medication(
        dose=match.group("dose"),
        frequency=match.group("frequency"),
        name=match.group("name"),
        route=match.group("route"),
        source_text=source_text,
        status=status,
        unit=match.group("unit"),
    )
