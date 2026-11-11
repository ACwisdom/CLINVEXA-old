"""Patient-bound consultation recording and medical-draft workflow."""

from __future__ import annotations

import json
import hashlib
import io
import re
import threading
import wave
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable, Literal, Mapping
from uuid import uuid4

ConsultationStatus = Literal["recording", "processing", "ready", "failed"]
ConsultationAnalysisMode = Literal["pending", "ai", "deterministic_fallback"]
MarkerLabel = Literal[
    "chief_complaint",
    "present_illness",
    "past_history",
    "allergy_history",
    "medication_history",
    "examination",
    "assessment",
    "plan",
    "important",
]

MAX_CONSULTATION_AUDIO_BYTES = 256 * 1024 * 1024
CONSULTATION_DRAFT_SCHEMA_VERSION = "clinvexa.consultation-draft.v1"
CONSULTATION_DRAFT_LANGUAGE = "zh-CN"

MARKER_TITLES: Mapping[MarkerLabel, str] = {
    "chief_complaint": "主诉",
    "present_illness": "现病史",
    "past_history": "既往史",
    "allergy_history": "过敏史",
    "medication_history": "用药史",
    "examination": "检查信息",
    "assessment": "初步判断",
    "plan": "诊疗计划",
    "important": "重点内容",
}

FIELD_TITLES: tuple[tuple[str, str], ...] = (
    ("chief_complaint", "主诉"),
    ("present_illness", "现病史"),
    ("past_history", "既往史"),
    ("allergy_history", "过敏史"),
    ("medication_history", "用药史"),
    ("examination_summary", "检查检验信息"),
    ("preliminary_assessment", "初步判断"),
    ("treatment_plan", "处置建议"),
    ("followup_plan", "随访计划"),
)

MISSING_DRAFT_CONTENT = "对话未涉及，待医生补充"

SYMPTOM_KEYWORDS = (
    "不适",
    "疼",
    "痛",
    "咳",
    "发热",
    "低热",
    "高热",
    "头晕",
    "恶心",
    "呕吐",
    "腹泻",
    "乏力",
    "气短",
    "胸闷",
    "心悸",
    "咽",
    "痰",
    "喘",
    "出血",
    "皮疹",
)

NEGATION_PREFIXES = ("无", "未", "否认", "没有", "未见")

QUESTION_TOKENS = ("吗", "么", "是否", "有没有", "有无", "什么", "哪", "几", "多久", "怎么", "如何")
SPEAKER_PREFIX = re.compile(r"^(?:(?:医生|医师|大夫|患者|病人|家属|护士|陪同者)\s*[：:]\s*)+")


class ConsultationError(RuntimeError):
    """Report an invalid consultation workflow operation."""


@dataclass(frozen=True, slots=True)
class ConsultationMarker:
    """One doctor-created marker tied to the recording timeline."""

    id: str
    label: MarkerLabel
    note: str
    offset_ms: int


@dataclass(frozen=True, slots=True)
class ConsultationDraft:
    """Review-required medical record draft extracted from one transcript."""

    allergy_history: str
    chief_complaint: str
    examination_summary: str
    followup_plan: str
    medication_history: str
    past_history: str
    preliminary_assessment: str
    present_illness: str
    quality_issues: tuple[str, ...]
    requires_human_review: bool
    source_evidence: Mapping[str, str]
    treatment_plan: str


@dataclass(frozen=True, slots=True)
class ConsultationRecord:
    """Persisted consultation state owned by the CLINVEXA service."""

    analysis_mode: ConsultationAnalysisMode
    analysis_warning: str | None
    audio_path: str | None
    consent_confirmed: bool
    draft: ConsultationDraft | None
    duration_ms: int
    ended_at: str | None
    error: str | None
    id: str
    markers: tuple[ConsultationMarker, ...]
    patient_id: str
    patient_name: str
    raw_transcript: str
    started_at: str
    status: ConsultationStatus
    transcript: str
    segments: tuple[dict, ...] = ()
    doctor_draft: str | None = None
    doctor_draft_revision: int = 0
    dialect: str = "auto"
    analysis_segments: int = 0
    suggestions: tuple[dict, ...] = ()
    corrected_transcript: str | None = None
    corrected_segments: int = 0
    analysis_turns: tuple[dict, ...] = ()


Transcriber = Callable[[str], Mapping[str, object]]
ConsultationAnalyzer = Callable[[str], Mapping[str, object]]


class ConsultationService:
    """Create, persist, transcribe, and analyze consultation recordings."""

    def __init__(
        self,
        root: Path,
        transcriber: Transcriber | None = None,
        analyzer: ConsultationAnalyzer | None = None,
    ) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._transcriber = transcriber or _transcribe_simplified_chinese
        self._stream_transcriber = transcriber or _transcribe_live_chinese
        self._custom_transcriber = transcriber is not None
        self._analyzer = analyzer or _analyze_consultation_with_configured_model
        self._lock = threading.RLock()
        self._segment_locks: dict[str, threading.Lock] = {}

    def append_audio(self, consultation_id: str, *, sequence: int, audio: bytes) -> ConsultationRecord:
        """Commit an independently decodable PCM segment exactly once, in order."""
        safe_id = _safe_id(consultation_id)
        if sequence < 0 or sequence >= 3600 or not audio or len(audio) > 2_000_000:
            raise ConsultationError("音频分段编号或大小无效")
        try:
            with wave.open(io.BytesIO(audio), "rb") as wav:
                duration = int(wav.getnframes() / wav.getframerate() * 1000)
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 0 < duration <= 12000:
                    raise ValueError("unsupported PCM")
        except (ValueError, EOFError, wave.Error) as exc:
            raise ConsultationError("需要不超过 12 秒的单声道 PCM WAV 分段") from exc
        digest = hashlib.sha256(audio).hexdigest()
        with self._lock:
            segment_lock = self._segment_locks.setdefault(safe_id, threading.Lock())
        with segment_lock:
            record = self.get(safe_id)
            if sequence < len(record.segments):
                if record.segments[sequence]["digest"] != digest:
                    raise ConsultationError("重复分段内容不一致，请保留原音频后重试")
                return record
            if record.status != "recording" or sequence != len(record.segments):
                raise ConsultationError("分段顺序不连续或问诊已结束，请先恢复待处理分段")
            audio_path = self.root / safe_id / f"segment-{sequence:05d}.wav"
            if audio_path.exists() and hashlib.sha256(audio_path.read_bytes()).hexdigest() != digest:
                raise ConsultationError("已保留分段与重试内容不一致，请恢复原录音")
            pending_path = audio_path.with_suffix('.pending')
            pending_path.write_bytes(audio)
            pending_path.replace(audio_path)
            if self._custom_transcriber:
                result = self._stream_transcriber(str(audio_path))
            else:
                from clinvexa.live_asr import transcribe
                result = transcribe(str(audio_path), dialect=record.dialect)
            if not result.get("success"):
                reason = str(result.get('error') or '识别引擎未返回有效结果')[:300]
                raise ConsultationError(f"音频分段已保留，转写失败：{reason}")
            text = str(result.get("transcript") or "").strip()
            segment = {"sequence": sequence, "digest": digest, "text": text,
                       "asr_provider": result.get("provider"), "language": result.get("language"),
                       "latency_ms": result.get("latency_ms"),
                       "duration_ms": duration, "audio_path": str(audio_path)}
            # A marker may arrive while ASR runs; reload before the atomic commit.
            with self._lock:
                record = self.get(safe_id)
                if record.status != "recording":
                    raise ConsultationError("问诊已结束，尾段未合入，请核对已保留音频")
                segments = (*record.segments, segment)
                raw = _join_stream_text(item["text"] for item in segments if item["text"])
                transcript = _normalize_fallback_record(raw) if raw else ""
                if record.corrected_transcript is not None:
                    tail = _join_stream_text(item["text"] for item in segments[record.corrected_segments:] if item["text"])
                    transcript = record.corrected_transcript + ("\n说话人待确认：" + tail if tail else "")
                updated = replace(record, segments=segments, raw_transcript=raw, transcript=transcript,
                                  duration_ms=sum(item["duration_ms"] for item in segments),
                                  analysis_mode=record.analysis_mode if record.analysis_segments else "pending",
                                  analysis_warning="新转写已加入，正在更新病历与建议。",
                                  draft=record.draft)
                self._save(updated)
                return updated

    def recover_audio(self, consultation_id: str) -> ConsultationRecord:
        """Replay durable, uncommitted packets after a service/application restart."""
        record = self.get(consultation_id)
        while record.status == 'recording':
            sequence = len(record.segments)
            path = self.root / _safe_id(consultation_id) / f'segment-{sequence:05d}.wav'
            if not path.is_file():
                break
            record = self.append_audio(consultation_id, sequence=sequence, audio=path.read_bytes())
        return record

    def finish_stream(self, consultation_id: str, *, segment_count: int, duration_ms: int) -> ConsultationRecord:
        """Finalize committed segments without retranscribing the entire visit."""
        with self._lock:
            record = self.get(consultation_id)
            if (self.root / _safe_id(consultation_id) / f'segment-{len(record.segments):05d}.wav').is_file():
                raise ConsultationError('仍有已保存音频未处理，请点击重试恢复后再结束')
            if len(record.segments) != segment_count or not record.transcript:
                raise ConsultationError("仍有音频未处理或未识别到问诊内容，请恢复分段后再结束")
            if record.status == "ready":
                return record
            if record.status != "recording":
                raise ConsultationError("当前问诊不能结束")
            updated = replace(record, status="ready", ended_at=_now(), duration_ms=duration_ms)
            self._save(updated)
            return updated

    def save_doctor_draft(self, consultation_id: str, *, draft: str, revision: int) -> ConsultationRecord:
        if len(draft) > 50000:
            raise ConsultationError("草稿超过 50000 字符")
        with self._lock:
            record = self.get(consultation_id)
            if revision != record.doctor_draft_revision:
                raise ConsultationError("草稿已在其他窗口更新，请重新载入后合并")
            updated = replace(record, doctor_draft=draft, doctor_draft_revision=revision + 1)
            self._save(updated)
            return updated

    def recent(self) -> list[dict[str, object]]:
        rows = []
        for path in sorted(self.root.glob("*/consultation.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:50]:
            try:
                record = self.get(path.parent.name)
                rows.append({"id": record.id, "patient_id": record.patient_id, "patient_name": record.patient_name,
                             "started_at": record.started_at, "status": record.status})
            except ConsultationError:
                continue
        return rows

    def correct_transcript(self, consultation_id: str, *, text: str, segment_count: int) -> ConsultationRecord:
        if not text.strip() or len(text) > 50000:
            raise ConsultationError("校正后的转写不能为空或超过50000字")
        with self._lock:
            record = self.get(consultation_id)
            if segment_count != len(record.segments):
                raise ConsultationError("已有新的录音内容，请暂停录音并重新核对转写后保存")
            updated = replace(record, transcript=text.strip(), corrected_transcript=text.strip(),
                corrected_segments=segment_count, analysis_segments=0, analysis_mode="pending",
                suggestions=(), analysis_warning="转写已由医生校正，等待重新分析")
            self._save(updated)
            return updated

    def start(self, *, patient_id: str, patient_name: str, consent_confirmed: bool, dialect: str = "auto") -> ConsultationRecord:
        """Start a patient-bound recording after explicit consent confirmation."""
        normalized_patient_id = patient_id.strip()
        if not normalized_patient_id:
            raise ConsultationError("患者编号不能为空")
        if not consent_confirmed:
            raise ConsultationError("开始记录前必须确认患者已知情")
        if dialect not in {"auto", "zh", "yue", "shanghai", "beijing"}:
            raise ConsultationError("不支持的方言选项")
        if not self._custom_transcriber:
            from clinvexa.live_asr import warmup
            readiness = warmup(dialect)
            if not readiness['ready']:
                raise ConsultationError(readiness['error'] or '语音识别模型仍在准备，请稍后重试')

        record = ConsultationRecord(
            analysis_mode="pending",
            analysis_warning=None,
            audio_path=None,
            consent_confirmed=True,
            draft=None,
            duration_ms=0,
            ended_at=None,
            error=None,
            id=uuid4().hex,
            markers=(),
            patient_id=normalized_patient_id,
            patient_name=patient_name.strip(),
            raw_transcript="",
            started_at=_now(),
            status="recording",
            transcript="",
            dialect=dialect,
        )
        self._save(record)
        return record

    def analyze_stream(self, consultation_id: str):
        """Analyze a snapshot without blocking capture or overwriting doctor edits."""
        from clinvexa.consultation_intelligence import FIELDS, stream_analysis
        snapshot = self.get(consultation_id)
        count = len(snapshot.segments)
        if not snapshot.transcript:
            yield {"type": "error", "message": "尚无可分析的转写内容"}
            return
        yield {"type": "progress", "message": f"已读取 {count} 段问诊，正在提取病历事实与检查建议"}
        values = {key: "" for key in FIELDS}
        evidence, suggestions, turns = {}, [], []
        try:
            for item in stream_analysis(snapshot.transcript):
                if item["type"] == "field":
                    values[item["key"]] = item["value"]
                    evidence[item["key"]] = item["evidence"]
                elif item["type"] == "utterance" and len(turns) < 12:
                    turns.append(item)
                elif item["type"] == "suggestion" and len(suggestions) < 3:
                    suggestions.append(item)
                yield item
            if not evidence:
                if turns:
                    # A doctor's opening questions contain no patient facts yet.
                    # Successful role analysis is not a model connection failure.
                    yield {"type": "progress", "message": "已记录问诊对话，尚无足够的患者病情事实，等待补充回答。"}
                    yield {"type": "done", "record": consultation_payload(self.get(consultation_id))}
                    return
                raise ValueError("no grounded fields")
            draft = ConsultationDraft(**values, source_evidence=evidence, requires_human_review=True,
                quality_issues=tuple(f"{title}尚无明确记录，请核对" for key, title in FIELDS.items() if not values[key]))
            with self._lock:
                current = self.get(consultation_id)
                if count >= current.analysis_segments and current.corrected_transcript == snapshot.corrected_transcript:
                    current = replace(current, draft=draft, analysis_mode="ai", analysis_segments=count,
                        analysis_warning=None if count == len(current.segments) else "新增转写等待下一轮分析",
                        suggestions=tuple(suggestions), analysis_turns=tuple(turns))
                    self._save(current)
            yield {"type": "done", "record": consultation_payload(current)}
        except Exception as exc:
            # Provider exception strings may include private prompts or credentials.
            name, status = type(exc).__name__, getattr(exc, "status_code", None)
            if status in (401, 403):
                message = "模型鉴权失败，请在设置中核对当前模型服务的凭据，再重新分析。"
            elif status == 429:
                message = "模型服务限流，请稍后重新分析。"
            elif "Timeout" in name:
                message = "模型响应超时，已保留转写和已有草稿，请重新分析。"
            elif isinstance(exc, ValueError):
                message = "模型未返回可核对的结构化结果，请校正转写后重新分析。"
            else:
                message = "模型连接中断或暂不可用，请核对模型设置后重新分析。"
            yield {"type": "error", "code": f"analysis_{status or name}", "message": message}

    def add_marker(
        self,
        consultation_id: str,
        *,
        label: MarkerLabel,
        offset_ms: int,
        note: str = "",
    ) -> ConsultationRecord:
        """Persist a marker without interrupting the active recording."""
        if offset_ms < 0:
            raise ConsultationError("重点标记时间不能为负数")
        with self._lock:
            record = self.get(consultation_id)
            if record.status != "recording":
                raise ConsultationError("只有录音中的问诊可以添加重点标记")
            marker = ConsultationMarker(
                id=uuid4().hex,
                label=label,
                note=note.strip(),
                offset_ms=offset_ms,
            )
            updated = replace(record, markers=(*record.markers, marker))
            self._save(updated)
            return updated

    def finish(
        self,
        consultation_id: str,
        *,
        audio: bytes,
        content_type: str,
        duration_ms: int,
    ) -> ConsultationRecord:
        """Save audio, transcribe it, analyze it, and persist the final draft."""
        if not audio:
            raise ConsultationError("问诊录音为空，请重新录制")
        if len(audio) > MAX_CONSULTATION_AUDIO_BYTES:
            raise ConsultationError("问诊录音超过256MB，请缩短单次录制时长")
        if duration_ms <= 0:
            raise ConsultationError("问诊录音时长无效")

        with self._lock:
            record = self.get(consultation_id)
            if record.status not in {"recording", "failed"}:
                raise ConsultationError("当前问诊不能重复结束")
            audio_path = self._audio_path(consultation_id, content_type)
            audio_path.write_bytes(audio)
            processing = replace(
                record,
                audio_path=str(audio_path),
                duration_ms=duration_ms,
                error=None,
                status="processing",
            )
            self._save(processing)

        try:
            result = self._transcriber(str(audio_path))
            raw_transcript = str(result.get("transcript") or "").strip()
            if not result.get("success") or not raw_transcript:
                raise ConsultationError(str(result.get("error") or "未识别到有效中文问诊内容"))

            analysis_mode: ConsultationAnalysisMode = "ai"
            analysis_warning: str | None = None
            try:
                analyzed = self._analyzer(raw_transcript)
                transcript = _validated_consultation_record(analyzed)
            except Exception as analysis_error:
                # A usable, explicitly-labelled fallback is safer than losing a
                # completed consultation when the configured model is offline.
                transcript = _normalize_fallback_record(raw_transcript)
                analysis_mode = "deterministic_fallback"
                analysis_warning = (
                    "AI 问诊整理暂不可用，当前显示的是确定性降级记录；"
                    f"请医生重点核对说话人和遗漏信息。原因：{_safe_analysis_error(analysis_error)}"
                )

            draft = analyze_consultation_transcript(transcript, processing.markers)
            completed = replace(
                processing,
                analysis_mode=analysis_mode,
                analysis_warning=analysis_warning,
                draft=draft,
                ended_at=_now(),
                error=None,
                raw_transcript=raw_transcript,
                status="ready",
                transcript=transcript,
            )
            self._save(completed)
            return completed
        except Exception as exc:
            message = str(exc) or "问诊记录处理失败"
            failed = replace(processing, ended_at=_now(), error=message, status="failed")
            self._save(failed)
            if isinstance(exc, ConsultationError):
                raise
            raise ConsultationError(message) from exc

    def get(self, consultation_id: str) -> ConsultationRecord:
        """Load a consultation by its opaque server-generated identifier."""
        safe_id = _safe_id(consultation_id)
        path = self.root / safe_id / "consultation.json"
        if not path.is_file():
            raise ConsultationError("未找到该问诊记录")
        try:
            return _record_from_payload(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ConsultationError("问诊记录已损坏，无法读取") from exc

    def _audio_path(self, consultation_id: str, content_type: str) -> Path:
        extension = {
            "audio/mp4": ".m4a",
            "audio/ogg": ".ogg",
            "audio/ogg;codecs=opus": ".ogg",
            "audio/wav": ".wav",
            "audio/webm": ".webm",
            "audio/webm;codecs=opus": ".webm",
        }.get(content_type.lower().strip(), ".webm")
        directory = self.root / _safe_id(consultation_id)
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"source{extension}"

    def _save(self, record: ConsultationRecord) -> None:
        directory = self.root / _safe_id(record.id)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "consultation.json"
        temporary = directory / "consultation.json.tmp"
        temporary.write_text(json.dumps(asdict(record), ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(target)


def analyze_consultation_transcript(
    transcript: str,
    markers: tuple[ConsultationMarker, ...] = (),
) -> ConsultationDraft:
    """Extract a conservative, evidence-bound draft from Chinese consultation text."""
    normalized = re.sub(r"[ \t]+", " ", transcript).strip()
    if not normalized:
        raise ConsultationError("问诊转写内容为空")
    clauses = _clauses(normalized)

    # This is deliberately a deterministic extractor rather than a model call.
    # The same transcript must always produce the same nine-field draft even
    # when the user switches inference providers or the Agent is offline.
    fields: dict[str, str] = {
        "chief_complaint": _extract_labeled(normalized, ("主诉",))
        or _extract_chief_complaint(clauses),
        "present_illness": _extract_labeled(normalized, ("现病史",))
        or _extract_present_illness(clauses),
        "past_history": _extract_labeled(normalized, ("既往史",))
        or _match_clauses(
            clauses,
            ("既往", "既往史", "以前患", "患有", "病史", "高血压", "血压高", "糖尿病", "冠心病", "手术史", "住院史"),
            limit=4,
            exclude=("家族", "过敏", "诊断为", "初步诊断"),
        ),
        "allergy_history": _extract_labeled(normalized, ("过敏史",))
        or _match_clauses(clauses, ("过敏",), limit=3),
        "medication_history": _extract_labeled(normalized, ("用药史", "用药"))
        or _match_clauses(
            clauses,
            ("服用", "口服", "吃药", "吃过", "用药", "自行服药", "未服药", "未用药", "片", "胶囊", "毫克", "mg"),
            limit=4,
            exclude=("建议", "拟用", "处方"),
        ),
        "examination_summary": _extract_labeled(normalized, ("检查检验信息", "检查摘要", "检查", "检验"))
        or _match_clauses(
            clauses,
            (
                "体温",
                "血压",
                "心率",
                "呼吸频率",
                "呼吸次数",
                "呼吸每分",
                "血氧",
                "血糖",
                "血常规",
                "检查",
                "检验",
                "化验",
                "影像",
                "CT",
                "MRI",
                "超声",
                "彩超",
            ),
            limit=6,
            exclude=(
                "建议检查",
                "建议复查",
                "病史",
                "否认高血压",
                "没有高血压",
                "无高血压",
                "否认血压高",
            ),
        ),
        "preliminary_assessment": _extract_labeled(normalized, ("初步判断", "初步诊断", "诊断"))
        or _match_clauses(clauses, ("考虑", "初步判断", "初步诊断", "诊断为", "提示", "待排"), limit=3),
        "treatment_plan": _extract_labeled(normalized, ("处置建议", "诊疗计划", "处置计划", "处理"))
        or _match_clauses(
            clauses,
            ("建议", "处理", "处置", "治疗", "开药", "休息", "补液", "注意"),
            limit=5,
            exclude=("复诊", "随访", "复查"),
        ),
        "followup_plan": _extract_labeled(normalized, ("随访计划", "随访"))
        or _match_clauses(clauses, ("复诊", "随访", "观察", "再来", "复查", "及时就医"), limit=4),
    }

    marker_field = {
        "chief_complaint": "chief_complaint",
        "present_illness": "present_illness",
        "past_history": "past_history",
        "allergy_history": "allergy_history",
        "medication_history": "medication_history",
        "examination": "examination_summary",
        "assessment": "preliminary_assessment",
        "plan": "treatment_plan",
    }
    for marker in markers:
        field = marker_field.get(marker.label)
        if field and marker.note:
            fields[field] = _merge_text(fields[field], marker.note)

    fields = {name: _normalize_field_value(name, value) for name, value in fields.items()}
    source_evidence = {name: value for name, value in fields.items() if value}
    quality_issues = tuple(
        f"缺少{title}，请医生补充"
        for name, title in FIELD_TITLES
        if not fields[name]
    )
    return ConsultationDraft(
        allergy_history=fields["allergy_history"],
        chief_complaint=fields["chief_complaint"],
        examination_summary=fields["examination_summary"],
        followup_plan=fields["followup_plan"],
        medication_history=fields["medication_history"],
        past_history=fields["past_history"],
        preliminary_assessment=fields["preliminary_assessment"],
        present_illness=fields["present_illness"],
        quality_issues=quality_issues,
        requires_human_review=True,
        source_evidence=source_evidence,
        treatment_plan=fields["treatment_plan"],
    )


def _safe_analysis_error(error: Exception) -> str:
    """Return an actionable Chinese reason without exposing provider payloads or credentials."""
    message = str(error).strip()
    lowered = message.lower()
    if "invalid_api_key" in lowered or "incorrect api key" in lowered or "apikey" in lowered and "401" in lowered:
        return "当前模型 API Key 无效，请在 CLINVEXA 设置中更新模型凭证"
    if "401" in lowered or "unauthorized" in lowered:
        return "当前模型鉴权失败，请在 CLINVEXA 设置中检查模型凭证"
    if "timeout" in lowered or "timed out" in lowered:
        return "模型服务响应超时"
    return message or "模型调用失败"


def build_consultation_draft_text(record: ConsultationRecord) -> str:
    """Render a review-ready plain-text medical record draft."""
    if record.draft is None:
        return ""
    lines = [
        "CLINVEXA 问诊病历草稿",
        f"患者编号：{record.patient_id}",
        f"患者姓名：{record.patient_name or '未填写'}",
    ]
    for name, title in FIELD_TITLES:
        lines.append(f"{title}：{getattr(record.draft, name) or MISSING_DRAFT_CONTENT}")
    lines.append(
        "医生复核项："
        + ("；".join(record.draft.quality_issues) if record.draft.quality_issues else "九项内容均已提取，仍需医生核对原始问诊记录")
    )
    lines.append("提示：本内容为问诊记录自动整理的病历草稿，必须经医生复核后使用。")
    return "\n".join(lines)


def consultation_payload(record: ConsultationRecord) -> dict[str, object]:
    """Serialize one record for the local HTTP API."""
    payload = asdict(record)
    payload["draft_schema_version"] = CONSULTATION_DRAFT_SCHEMA_VERSION
    payload["draft_language"] = CONSULTATION_DRAFT_LANGUAGE
    payload["draft_text"] = record.doctor_draft if record.doctor_draft is not None else build_consultation_draft_text(record)
    payload["draft_fields"] = [
        {
            "key": name,
            "title": title,
            "value": (getattr(record.draft, name) if record.draft else "") or MISSING_DRAFT_CONTENT,
            "status": "present" if record.draft and getattr(record.draft, name) else "not_mentioned",
            "source_evidence": (record.draft.source_evidence.get(name, "") if record.draft else ""),
        }
        for name, title in FIELD_TITLES
    ]
    payload["marker_titles"] = [
        {
            "id": marker.id,
            "label": marker.label,
            "title": MARKER_TITLES[marker.label],
            "note": marker.note,
            "offset_ms": marker.offset_ms,
        }
        for marker in record.markers
    ]
    return payload


def _transcribe_simplified_chinese(path: str) -> Mapping[str, object]:
    from tools.transcription_tools import transcribe_audio

    return transcribe_audio(path, model="medium")


def _transcribe_live_chinese(path: str) -> Mapping[str, object]:
    # Independently validated WAV needs no ffmpeg subprocess or full-file pass.
    # Reuse the same warm model and the shared silence/confidence protections.
    from tools.transcription_tools import _normalize_clinvexa_transcript, _transcribe_local
    from clinvexa.live_asr import model_directory, transcribe

    if model_directory() is not None:
        return _normalize_clinvexa_transcript(transcribe(path))
    return _normalize_clinvexa_transcript(_transcribe_local(path, "medium", realtime=True))


def _join_stream_text(parts) -> str:
    """Packet boundaries are not sentence boundaries (e.g. 血 / 常规)."""
    result = ""
    for part in parts:
        if result and part:
            cjk_boundary = "\u4e00" <= result[-1] <= "\u9fff" and "\u4e00" <= part[0] <= "\u9fff"
            if not cjk_boundary:
                result += " "
        result += part
    return result


def _analyze_consultation_with_configured_model(transcript: str) -> Mapping[str, object]:
    """Restore evidence-bound doctor/patient turns with the configured main model."""
    from agent.auxiliary_client import call_llm
    from agent.agent_runtime_helpers import strip_think_blocks

    response = call_llm(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是 CLINVEXA 问诊记录整理器。把中文语音转写恢复成简体中文医患问答记录。"
                    "只整理原文事实，不新增症状、诊断、药物、检查、时间或数值，不做临床推断。"
                    "必须保留否定、犹豫、不确定和时间关系，并重点保留主诉、现病史、既往疾病/手术、"
                    "过敏、用药、检查检验、医生初步判断、处置与随访。能判断说话人时逐行写“医生：”"
                    "或“患者：”；不能判断时写“说话人待确认：”，不得猜测。"
                    "仅返回 JSON：{\"consultation_record\":\"...\"}，不要返回解释或 Markdown。"
                ),
            },
            {"role": "user", "content": f"原始语音转写：\n{transcript}"},
        ],
        temperature=0,
        max_tokens=3000,
        timeout=60,
    )
    content = strip_think_blocks(None, response.choices[0].message.content or "").strip()
    match = re.search(r"\{[\s\S]*\}", content)
    if not match:
        raise ConsultationError("模型未返回有效问诊记录 JSON")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ConsultationError("模型问诊记录格式无效")
    return parsed


def _validated_consultation_record(result: Mapping[str, object]) -> str:
    """Reject empty or non-dialogue model output before medical structuring."""
    record = str(result.get("consultation_record") or "").strip()
    if not record:
        raise ConsultationError(str(result.get("error") or "模型未生成简体中文问诊记录"))
    if not re.search(r"(?:医生|患者|说话人待确认)[：:]", record):
        raise ConsultationError("模型未按医患问答格式生成记录")
    if not re.search(r"[\u4e00-\u9fff]", record):
        raise ConsultationError("模型生成的问诊记录不是中文")
    return re.sub(r"\r\n?", "\n", record)


def _normalize_fallback_record(transcript: str) -> str:
    """Keep the original evidence readable when AI analysis is unavailable."""
    normalized = re.sub(r"[ \t]+", " ", transcript).strip()
    if re.search(r"(?:医生|患者|说话人待确认)[：:]", normalized):
        return normalized
    return f"说话人待确认：{normalized}"


def _safe_id(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}", value):
        raise ConsultationError("问诊记录编号无效")
    return value


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _clauses(text: str) -> tuple[str, ...]:
    """Split ASR prose into evidence-sized clauses instead of reusing one long sentence."""
    raw_clauses = [
        _clean_spoken_clause(item)
        for item in re.split(r"[。！？!?；;，,﹐、\n]+", text)
        if item.strip(" ，,﹐、；;：:")
    ]
    evidence: list[str] = []
    pending_question: tuple[str, str] | None = None

    for clause in raw_clauses:
        if not clause:
            continue
        question = _question_context(clause)
        if question:
            pending_question = question
            continue
        if any(token in clause for token in QUESTION_TOKENS):
            # A doctor's unanswered question is not patient evidence and must
            # never be copied into the medical draft as a positive finding.
            pending_question = None
            continue
        if pending_question:
            contextual_answer = _contextualize_short_answer(pending_question, clause)
            if contextual_answer:
                evidence.append(contextual_answer)
                pending_question = None
                continue
            pending_question = None
        evidence.append(clause)

    return tuple(dict.fromkeys(evidence))


def _clean_spoken_clause(value: str) -> str:
    """Remove speaker labels and harmless ASR fillers without changing facts."""
    cleaned = value.strip(" ，,﹐、；;：:\t")
    cleaned = SPEAKER_PREFIX.sub("", cleaned).strip()
    cleaned = re.sub(r"^(?:嗯+|啊+|呃+|这个|就是)\s*", "", cleaned).strip()
    return cleaned


def _question_context(clause: str) -> tuple[str, str] | None:
    """Classify a doctor's question so a short patient answer is not lost."""
    if not any(token in clause for token in QUESTION_TOKENS):
        return None
    if "过敏" in clause:
        return ("allergy_history", "药物过敏")
    if any(token in clause for token in ("吃药", "服药", "用药", "口服", "药物", "吃过", "用了")):
        return ("medication_history", "用药")
    if any(token in clause for token in ("检查", "检验", "化验", "彩超", "CT", "MRI")):
        return ("examination_summary", "检查")
    if any(token in clause for token in ("既往", "病史", "高血压", "糖尿病", "冠心病", "手术", "住院")):
        subject = re.sub(r"(?:以前|既往|有没有|是否有|有无|得过|患过|吗|么|病史)", "", clause).strip()
        return ("past_history", subject or "相关疾病")
    return None


def _contextualize_short_answer(context: tuple[str, str], answer: str) -> str:
    """Turn a terse Q&A response into a field-bound, reviewable fact."""
    field, subject = context
    normalized = answer.strip()
    if normalized in {"听不清", "没听清", "不清楚", "不知道", "记不清", "不确定", "不详"} or any(
        token in normalized for token in ("没听清", "听不清楚", "记不清楚")
    ):
        return ""
    is_negative = normalized in {"无", "没有", "否认", "没", "没有的", "从来没有", "都没有"} or normalized.startswith(
        ("没有", "否认", "从来没有")
    )
    if is_negative:
        if field == "allergy_history":
            return "否认药物过敏"
        if field == "medication_history":
            return "目前未用药"
        return f"否认{subject.removeprefix('有')}病史"
    if field == "allergy_history" and "过敏" not in normalized and len(normalized) <= 20:
        return f"{normalized}过敏"
    if field == "past_history" and "病史" not in normalized and len(normalized) <= 24:
        return f"{normalized}病史"
    return normalized


def _normalize_field_value(field: str, value: str) -> str:
    """Canonicalize separators and repeated clauses for stable draft output."""
    parts = [
        _clean_spoken_clause(part)
        for part in re.split(r"[；;]+", value)
        if _clean_spoken_clause(part)
    ]
    normalized = "；".join(dict.fromkeys(parts))
    if field == "medication_history" and normalized in {"没有用药", "未用药", "没有服药", "未服药", "没有吃药"}:
        return "目前未用药"
    return normalized


def _extract_labeled(text: str, labels: tuple[str, ...]) -> str:
    for label in labels:
        match = re.search(rf"(?:^|[。；;\n])\s*{re.escape(label)}[：:]\s*([^。；;\n]+)", text)
        if match:
            return match.group(1).strip()
    return ""


def _match_clauses(
    clauses: tuple[str, ...],
    keywords: tuple[str, ...],
    *,
    limit: int,
    exclude: tuple[str, ...] = (),
) -> str:
    matches: list[str] = []
    for clause in clauses:
        if (
            any(keyword.lower() in clause.lower() for keyword in keywords)
            and not any(keyword in clause for keyword in exclude)
            and clause not in matches
        ):
            matches.append(clause)
        if len(matches) >= limit:
            break
    return "；".join(matches)


def _extract_chief_complaint(clauses: tuple[str, ...]) -> str:
    candidates: list[str] = []
    for clause in clauses:
        if not any(keyword in clause for keyword in SYMPTOM_KEYWORDS):
            continue
        if clause.startswith(NEGATION_PREFIXES):
            continue
        if any(keyword in clause for keyword in ("体温", "血压", "心率", "血氧", "检查", "诊断", "建议")):
            continue
        candidates.append(clause)
        if re.search(r"(?:\d+|[一二三四五六七八九十半两]+)(?:天|周|月|年|小时)", clause):
            return clause
        if len(candidates) >= 2:
            break
    return "；".join(candidates)


def _extract_present_illness(clauses: tuple[str, ...]) -> str:
    matches: list[str] = []
    history_exclusions = (
        "既往",
        "病史",
        "过敏",
        "服用",
        "用药",
        "诊断",
        "建议",
        "复诊",
        "随访",
        "及时就医",
    )
    for clause in clauses:
        symptom_evidence = any(keyword in clause for keyword in SYMPTOM_KEYWORDS)
        course_evidence = any(keyword in clause for keyword in ("开始", "反复", "加重", "缓解", "伴有", "伴随"))
        negative_symptom = clause.startswith(NEGATION_PREFIXES) and symptom_evidence
        if (symptom_evidence or course_evidence or negative_symptom) and not any(
            keyword in clause for keyword in history_exclusions
        ):
            if not any(keyword in clause for keyword in ("本次检查", "体温", "血压", "心率", "血氧", "血糖")):
                matches.append(clause)
        if len(matches) >= 8:
            break
    return "；".join(dict.fromkeys(matches))


def _merge_text(current: str, note: str) -> str:
    if not current:
        return note
    if note in current:
        return current
    return f"{current}；{note}"


def _record_from_payload(payload: Mapping[str, object]) -> ConsultationRecord:
    marker_payloads = payload.get("markers") or []
    markers = tuple(ConsultationMarker(**item) for item in marker_payloads if isinstance(item, dict))
    draft_payload = payload.get("draft")
    draft = None
    if isinstance(draft_payload, dict):
        draft = ConsultationDraft(
            allergy_history=str(draft_payload.get("allergy_history") or ""),
            chief_complaint=str(draft_payload.get("chief_complaint") or ""),
            examination_summary=str(draft_payload.get("examination_summary") or ""),
            followup_plan=str(draft_payload.get("followup_plan") or ""),
            medication_history=str(draft_payload.get("medication_history") or ""),
            past_history=str(draft_payload.get("past_history") or ""),
            preliminary_assessment=str(draft_payload.get("preliminary_assessment") or ""),
            present_illness=str(draft_payload.get("present_illness") or ""),
            quality_issues=tuple(str(item) for item in draft_payload.get("quality_issues") or ()),
            requires_human_review=bool(draft_payload.get("requires_human_review", True)),
            source_evidence={
                str(key): str(value)
                for key, value in (draft_payload.get("source_evidence") or {}).items()
            },
            treatment_plan=str(draft_payload.get("treatment_plan") or ""),
        )
    return ConsultationRecord(
        analysis_mode=str(payload.get("analysis_mode") or "deterministic_fallback"),  # type: ignore[arg-type]
        analysis_warning=payload.get("analysis_warning") if isinstance(payload.get("analysis_warning"), str) else None,
        audio_path=payload.get("audio_path") if isinstance(payload.get("audio_path"), str) else None,
        consent_confirmed=bool(payload.get("consent_confirmed")),
        draft=draft,
        duration_ms=int(payload.get("duration_ms") or 0),
        ended_at=payload.get("ended_at") if isinstance(payload.get("ended_at"), str) else None,
        error=payload.get("error") if isinstance(payload.get("error"), str) else None,
        id=str(payload["id"]),
        markers=markers,
        patient_id=str(payload["patient_id"]),
        patient_name=str(payload.get("patient_name") or ""),
        raw_transcript=str(payload.get("raw_transcript") or payload.get("transcript") or ""),
        started_at=str(payload["started_at"]),
        status=str(payload["status"]),  # type: ignore[arg-type]
        transcript=str(payload.get("transcript") or ""),
        segments=tuple(payload.get("segments") or ()),
        doctor_draft=payload.get("doctor_draft") if isinstance(payload.get("doctor_draft"), str) else None,
        doctor_draft_revision=int(payload.get("doctor_draft_revision") or 0),
        dialect=str(payload.get("dialect") or "auto"),
        analysis_segments=int(payload.get("analysis_segments") or 0),
        suggestions=tuple(payload.get("suggestions") or ()),
        corrected_transcript=payload.get("corrected_transcript") if isinstance(payload.get("corrected_transcript"), str) else None,
        corrected_segments=int(payload.get("corrected_segments") or 0),
        analysis_turns=tuple(payload.get("analysis_turns") or ()),
    )
