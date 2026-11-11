from __future__ import annotations

from pathlib import Path

import pytest

from clinvexa.consultations import (
    ConsultationError,
    ConsultationService,
    analyze_consultation_transcript,
    build_consultation_draft_text,
)


def successful_transcriber(_: str) -> dict[str, object]:
    return {
        "success": True,
        "transcript": (
            "主诉：咳嗽三天，伴低热一天。\n"
            "现病史：三天前开始干咳，昨天最高体温37.8度。\n"
            "既往史：否认高血压和糖尿病。\n"
            "过敏史：否认药物过敏。\n"
            "检查：体温37.6度，血氧98%。\n"
            "初步判断：考虑急性上呼吸道感染。\n"
            "诊疗计划：建议休息补液，症状加重及时复诊。"
        ),
    }


def passthrough_analyzer(transcript: str) -> dict[str, object]:
    return {"consultation_record": f"医生：请描述本次情况。\n{transcript}"}


def test_consultation_requires_patient_and_consent(tmp_path: Path) -> None:
    service = ConsultationService(tmp_path, successful_transcriber, passthrough_analyzer)

    with pytest.raises(ConsultationError, match="患者编号"):
        service.start(patient_id="", patient_name="", consent_confirmed=True)
    with pytest.raises(ConsultationError, match="知情"):
        service.start(patient_id="P001", patient_name="张明", consent_confirmed=False)


def test_recording_marker_transcription_and_draft_form_one_persisted_flow(tmp_path: Path) -> None:
    service = ConsultationService(tmp_path, successful_transcriber, passthrough_analyzer)
    started = service.start(patient_id="P001", patient_name="张明", consent_confirmed=True)
    marked = service.add_marker(
        started.id,
        label="medication_history",
        offset_ms=12_500,
        note="患者自述未自行服药",
    )

    completed = service.finish(
        started.id,
        audio=b"synthetic webm audio",
        content_type="audio/webm;codecs=opus",
        duration_ms=38_000,
    )

    assert marked.markers[0].offset_ms == 12_500
    assert completed.status == "ready"
    assert completed.audio_path and Path(completed.audio_path).read_bytes() == b"synthetic webm audio"
    assert completed.draft is not None
    assert completed.draft.chief_complaint == "咳嗽三天，伴低热一天"
    assert completed.draft.medication_history == "患者自述未自行服药"
    assert completed.draft.requires_human_review is True
    assert "患者编号：P001" in build_consultation_draft_text(completed)
    assert service.get(started.id) == completed


def test_failed_transcription_is_persisted_and_can_be_retried(tmp_path: Path) -> None:
    responses = iter(
        (
            {"success": False, "error": "未识别到语音", "transcript": ""},
            {"success": True, "transcript": "主诉：头痛两天。过敏史：否认药物过敏。"},
        )
    )
    service = ConsultationService(tmp_path, lambda _: next(responses), passthrough_analyzer)
    started = service.start(patient_id="P002", patient_name="", consent_confirmed=True)

    with pytest.raises(ConsultationError, match="未识别到语音"):
        service.finish(
            started.id,
            audio=b"first attempt",
            content_type="audio/webm",
            duration_ms=1_000,
        )
    assert service.get(started.id).status == "failed"

    retried = service.finish(
        started.id,
        audio=b"second attempt",
        content_type="audio/webm",
        duration_ms=2_000,
    )
    assert retried.status == "ready"
    assert retried.draft and retried.draft.chief_complaint == "头痛两天"


def test_unlabeled_transcript_is_conservatively_extracted() -> None:
    draft = analyze_consultation_transcript(
        "患者咳嗽三天，昨天开始发热。体温三十七点八度。否认药物过敏。建议三天后复诊。"
    )

    assert "咳嗽三天" in draft.chief_complaint
    assert "否认药物过敏" in draft.allergy_history
    assert "复诊" in draft.followup_plan
    assert draft.requires_human_review is True


def test_unlabeled_asr_paragraph_is_split_into_nine_evidence_bound_fields() -> None:
    transcript = (
        "患者小雷，男，45岁，三天前开始咳嗽，以咳嗽为主，偶尔有痰，"
        "昨天开始低热，最高体温39度，伴随咽喉痛，无胸痛，无明显气促，"
        "否认高血压和糖尿病病史，没有过敏史，本次检查体温37度，心率86次/分，"
        "血压和血糖正常，初步诊断为急性上呼吸道感染，三天后复诊，如症状加重及时就医。"
    )

    draft = analyze_consultation_transcript(transcript)

    assert draft.chief_complaint == "三天前开始咳嗽"
    assert "偶尔有痰" in draft.present_illness
    assert "否认高血压和糖尿病病史" in draft.past_history
    assert draft.allergy_history == "没有过敏史"
    assert draft.medication_history == ""
    assert "心率86次/分" in draft.examination_summary
    assert "高血压" not in draft.examination_summary
    assert draft.preliminary_assessment == "初步诊断为急性上呼吸道感染"
    assert draft.treatment_plan == ""
    assert "三天后复诊" in draft.followup_plan
    assert all(value != transcript for value in draft.source_evidence.values())
    assert len(set(draft.source_evidence.values())) == len(draft.source_evidence)


def test_chinese_stt_small_comma_is_treated_as_an_evidence_boundary() -> None:
    transcript = (
        "咳嗽三天﹐昨天开始低热﹐没有药物过敏﹐未自行服药﹐本次检查体温37.6度﹐"
        "初步诊断为急性上呼吸道感染﹐建议休息补液﹐三天后复诊。"
    )

    draft = analyze_consultation_transcript(transcript)

    assert draft.chief_complaint == "咳嗽三天"
    assert draft.allergy_history == "没有药物过敏"
    assert draft.medication_history == "未自行服药"
    assert draft.examination_summary == "本次检查体温37.6度"
    assert draft.preliminary_assessment == "初步诊断为急性上呼吸道感染"
    assert draft.treatment_plan == "建议休息补液"
    assert draft.followup_plan == "三天后复诊"
    assert all("﹐" not in value for value in draft.source_evidence.values())


def test_rendered_draft_has_required_headings_and_explicit_missing_content(tmp_path: Path) -> None:
    service = ConsultationService(
        tmp_path,
        lambda _: {"success": True, "transcript": "主诉：头痛两天。过敏史：否认药物过敏。"},
        passthrough_analyzer,
    )
    started = service.start(patient_id="P003", patient_name="李医生测试患者", consent_confirmed=True)
    completed = service.finish(
        started.id,
        audio=b"synthetic audio",
        content_type="audio/webm",
        duration_ms=1_000,
    )

    text = build_consultation_draft_text(completed)
    for heading in (
        "主诉",
        "现病史",
        "既往史",
        "过敏史",
        "用药史",
        "检查检验信息",
        "初步判断",
        "处置建议",
        "随访计划",
    ):
        assert f"{heading}：" in text
    assert "用药史：对话未涉及，待医生补充" in text
    assert "检查检验信息：对话未涉及，待医生补充" in text


def test_real_world_spoken_dialogue_has_stable_field_bound_output() -> None:
    transcript = (
        "医生：哪里不舒服？患者：胸闷心悸两天，今天早上加重。"
        "医生：还伴有别的不舒服吗？患者：偶尔恶心，没有呕吐，也没有胸痛。"
        "医生：以前有高血压糖尿病吗？患者：没有。"
        "医生：有没有药物过敏？患者：青霉素。"
        "医生：现在吃什么药？患者：没有用药。"
        "医生：刚才量了血压一百五十比九十五，心率一百零二次每分，血氧百分之九十八。"
        "医生：初步考虑心律失常待排。建议完善心电图和电解质检查，症状加重立即就医，三天后复诊。"
    )

    first = analyze_consultation_transcript(transcript)
    second = analyze_consultation_transcript(transcript)

    assert first == second
    assert "胸闷心悸两天" in first.chief_complaint
    assert "今天早上加重" in first.present_illness
    assert first.past_history == "否认高血压糖尿病病史"
    assert first.allergy_history == "青霉素过敏"
    assert first.medication_history == "目前未用药"
    assert "血压一百五十比九十五" in first.examination_summary
    assert "初步考虑心律失常待排" in first.preliminary_assessment
    assert "完善心电图和电解质检查" in first.treatment_plan
    assert "三天后复诊" in first.followup_plan
    assert all(not value.startswith(("医生：", "患者：")) for value in first.source_evidence.values())


def test_question_text_never_becomes_patient_history_without_an_answer() -> None:
    draft = analyze_consultation_transcript("医生：有没有青霉素过敏？患者：听不清。主诉：头痛一天。")

    assert draft.allergy_history == ""
    assert draft.chief_complaint == "头痛一天"


def test_rendered_draft_uses_versioned_fixed_protocol(tmp_path: Path) -> None:
    service = ConsultationService(
        tmp_path,
        lambda _: {"success": True, "transcript": "主诉：头痛一天。"},
        passthrough_analyzer,
    )
    started = service.start(patient_id="P-FIXED", patient_name="", consent_confirmed=True)
    completed = service.finish(
        started.id,
        audio=b"synthetic audio",
        content_type="audio/webm",
        duration_ms=1_000,
    )

    lines = build_consultation_draft_text(completed).splitlines()
    assert lines[:3] == [
        "CLINVEXA 问诊病历草稿",
        "患者编号：P-FIXED",
        "患者姓名：未填写",
    ]
    assert [line.split("：", 1)[0] for line in lines[3:12]] == [
        "主诉",
        "现病史",
        "既往史",
        "过敏史",
        "用药史",
        "检查检验信息",
        "初步判断",
        "处置建议",
        "随访计划",
    ]


def test_raw_asr_is_ai_restored_before_nine_field_structuring(tmp_path: Path) -> None:
    raw = (
        "今天主要哪里不舒服这三天右上腹一阵一阵的痛吃完油腻以后更明显"
        "以前出现过吗半年前有过一次五年前做过剖宫产有没有药物过敏"
        "对磺胺类药物过敏现在长期吃什么药没有长期用药这两天吃过一次铝碳酸镁"
        "今天做检查了吗腹部彩超提示胆囊内多个强回声后方伴声影考虑胆囊结石相关疼痛"
        "一周后带报告复诊"
    )

    def transcriber(_: str) -> dict[str, object]:
        return {"success": True, "transcript": raw}

    def analyzer(value: str) -> dict[str, object]:
        assert value == raw
        return {
            "consultation_record": (
                "医生：今天主要哪里不舒服？\n患者：右上腹阵发性疼痛三天，进食油腻食物后更明显。\n"
                "医生：以前出现过类似情况吗？\n患者：半年前出现过一次。\n"
                "医生：以前做过手术吗？\n患者：五年前做过剖宫产。\n"
                "医生：有没有药物过敏？\n患者：对磺胺类药物过敏。\n"
                "医生：现在长期吃什么药？\n患者：没有长期用药，这两天吃过一次铝碳酸镁。\n"
                "医生：今天做检查了吗？\n患者：腹部彩超提示胆囊内多个强回声，后方伴声影。\n"
                "医生：目前考虑胆囊结石相关疼痛，一周后带报告复诊。"
            )
        }

    service = ConsultationService(tmp_path, transcriber, analyzer)
    started = service.start(patient_id="P-AI", patient_name="王鱼", consent_confirmed=True)
    completed = service.finish(
        started.id,
        audio=b"synthetic audio",
        content_type="audio/webm",
        duration_ms=12_000,
    )

    assert completed.analysis_mode == "ai"
    assert completed.analysis_warning is None
    assert completed.raw_transcript == raw
    assert completed.transcript.startswith("医生：今天主要哪里不舒服？")
    assert completed.draft is not None
    assert "右上腹阵发性疼痛三天" in completed.draft.chief_complaint
    assert "剖宫产" in completed.draft.past_history
    assert completed.draft.allergy_history == "对磺胺类药物过敏"
    assert "铝碳酸镁" in completed.draft.medication_history
    assert "腹部彩超" in completed.draft.examination_summary
    assert "胆囊结石相关疼痛" in completed.draft.preliminary_assessment
    assert "一周后带报告复诊" in completed.draft.followup_plan


def test_ai_failure_is_explicitly_labeled_and_preserves_raw_evidence(tmp_path: Path) -> None:
    service = ConsultationService(
        tmp_path,
        lambda _: {"success": True, "transcript": "腹痛三天没有发热"},
        lambda _: (_ for _ in ()).throw(RuntimeError("模型连接失败")),
    )
    started = service.start(patient_id="P-FALLBACK", patient_name="", consent_confirmed=True)
    completed = service.finish(
        started.id,
        audio=b"synthetic audio",
        content_type="audio/webm",
        duration_ms=1_000,
    )

    assert completed.status == "ready"
    assert completed.analysis_mode == "deterministic_fallback"
    assert completed.analysis_warning and "模型连接失败" in completed.analysis_warning
    assert completed.raw_transcript == "腹痛三天没有发热"
    assert completed.transcript == "说话人待确认：腹痛三天没有发热"


def test_ai_auth_failure_is_sanitized_for_the_consultation_ui(tmp_path: Path) -> None:
    service = ConsultationService(
        tmp_path,
        lambda _: {"success": True, "transcript": "腹痛三天"},
        lambda _: (_ for _ in ()).throw(
            RuntimeError("Error code: 401 - Incorrect API key provided: sk-secret invalid_api_key")
        ),
    )
    started = service.start(patient_id="P-AUTH", patient_name="", consent_confirmed=True)
    completed = service.finish(
        started.id,
        audio=b"synthetic audio",
        content_type="audio/webm",
        duration_ms=1_000,
    )

    assert completed.analysis_warning
    assert "当前模型 API Key 无效" in completed.analysis_warning
    assert "sk-secret" not in completed.analysis_warning
