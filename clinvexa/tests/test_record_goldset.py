from __future__ import annotations

from clinvexa.records import (
    NON_CLINICAL_DISCLAIMER,
    answer_medical_knowledge,
    build_followup_draft,
    build_one_page_summary,
    structure_medical_record,
)


def _synthetic_goldset() -> list[tuple[str, set[str]]]:
    allergy_cases = [
        ("不详", "unclear"),
        ("无药物过敏史", "absent"),
        ("青霉素过敏，既往出现皮疹", "present"),
    ]
    diagnosis_cases = [
        ("考虑病毒性上呼吸道感染", "病毒性上呼吸道感染", "suspected"),
        ("细菌性肺炎已排除", "细菌性肺炎", "ruled_out"),
        ("2型糖尿病", "2型糖尿病", "confirmed"),
    ]
    cases: list[tuple[str, set[str]]] = []
    for index in range(50):
        sex_raw, sex = ("女", "female") if index % 2 == 0 else ("男", "male")
        complaint = f"合成症状{index:02d}持续{index % 7 + 1}天"
        allergy_raw, allergy_status = allergy_cases[index % len(allergy_cases)]
        diagnosis_raw, diagnosis_name, certainty = diagnosis_cases[index % len(diagnosis_cases)]
        source = (
            f"性别：{sex_raw}\n"
            f"主诉：{complaint}\n"
            f"过敏史：{allergy_raw}\n"
            f"诊断：{diagnosis_raw}"
        )
        expected = {
            f"sex={sex}",
            f"chief_complaint={complaint}",
            f"allergy_status={allergy_status}",
            f"diagnosis={diagnosis_name}:{certainty}",
        }
        cases.append((source, expected))
    return cases


def test_fifty_record_goldset_meets_critical_field_precision_and_recall() -> None:
    true_positive = 0
    false_positive = 0
    false_negative = 0

    for index, (source, expected) in enumerate(_synthetic_goldset()):
        record = structure_medical_record(f"SYN-GOLD-{index:03d}", source)
        predicted = {
            f"sex={record.patient_sex}",
            f"chief_complaint={record.chief_complaint}",
            f"allergy_status={record.allergy_status}",
            *(f"diagnosis={item.name}:{item.certainty}" for item in record.diagnoses),
        }
        true_positive += len(predicted & expected)
        false_positive += len(predicted - expected)
        false_negative += len(expected - predicted)
        assert record.requires_human_review is True
        assert record.disclaimer == NON_CLINICAL_DISCLAIMER
        assert all(evidence.source_text in source for evidence in record.source_evidence)

    precision = true_positive / (true_positive + false_positive)
    recall = true_positive / (true_positive + false_negative)
    assert precision >= 0.99
    assert recall >= 0.98


def test_summary_followup_and_knowledge_outputs_do_not_invent_clinical_facts() -> None:
    source = "性别：女\n主诉：口渴2个月\n过敏史：不详\n诊断：血糖升高待查"
    record = structure_medical_record("SYN-SAFE-001", source)
    summary = build_one_page_summary(record)
    assert "口渴2个月" in summary
    assert "血糖升高" in summary
    assert "肺炎" not in summary

    followup = build_followup_draft(record, ["一周后复查空腹血糖", "出现明显不适及时就医"])
    assert followup.items == ("一周后复查空腹血糖", "出现明显不适及时就医")
    assert followup.requires_human_review is True

    unsupported = answer_medical_knowledge("如何解释该结果？", [])
    assert unsupported.answer == "依据不足"
    assert unsupported.sources == ()

    supported = answer_medical_knowledge("如何解释该结果？", ["院内指南-合成-001"])
    assert supported.sources == ("院内指南-合成-001",)
    assert supported.requires_human_review is True


def test_allergy_conflicts_and_diagnosis_certainty_are_never_auto_corrected() -> None:
    source = (
        "性别：男\n"
        "主诉：咳嗽2天\n"
        "过敏史：入院记录无药物过敏史；护理记录青霉素过敏，曾出现皮疹\n"
        "诊断：考虑病毒性上呼吸道感染；细菌性肺炎已排除"
    )

    record = structure_medical_record("SYN-CONFLICT-001", source)

    assert record.allergy_status == "conflict"
    assert "allergy conflict" in record.quality_issues
    assert {(item.name, item.certainty) for item in record.diagnoses} == {
        ("病毒性上呼吸道感染", "suspected"),
        ("细菌性肺炎", "ruled_out"),
    }
    assert not any(item.certainty == "confirmed" for item in record.diagnoses)
    summary = build_one_page_summary(record)
    assert "考虑病毒性上呼吸道感染" in summary
    assert "细菌性肺炎已排除" in summary


def test_ordinary_fields_reach_f1_threshold_on_fifty_synthetic_records() -> None:
    true_positive = 0
    false_positive = 0
    false_negative = 0

    for index in range(50):
        glucose = f"{6 + index / 10:.1f}"
        dose = "0.5" if index % 2 == 0 else "100"
        unit = "g" if index % 2 == 0 else "mg"
        medication = "二甲双胍" if index % 2 == 0 else "阿司匹林"
        source = (
            "性别：女\n"
            "主诉：合成测试\n"
            "过敏史：不详\n"
            "诊断：代谢指标异常待查\n"
            f"检验：空腹血糖 {glucose} mmol/L ↑\n"
            f"用药：{medication} {dose} {unit} 口服 bid 当前"
        )
        record = structure_medical_record(f"SYN-ORDINARY-{index:03d}", source)
        expected = {
            f"lab=空腹血糖:{glucose}:mmol/L:high",
            f"medication={medication}:{dose}:{unit}:口服:bid:current",
        }
        predicted = {
            *(f"lab={item.name}:{item.value}:{item.unit}:{item.flag}" for item in record.laboratory_results),
            *(
                f"medication={item.name}:{item.dose}:{item.unit}:{item.route}:{item.frequency}:{item.status}"
                for item in record.medications
            ),
        }
        true_positive += len(predicted & expected)
        false_positive += len(predicted - expected)
        false_negative += len(expected - predicted)

    precision = true_positive / (true_positive + false_positive)
    recall = true_positive / (true_positive + false_negative)
    f1 = 2 * precision * recall / (precision + recall)
    assert f1 >= 0.95


def test_summary_preserves_all_source_numeric_values_and_trends_exactly() -> None:
    source = (
        "性别：男\n"
        "主诉：口渴2个月\n"
        "过敏史：无药物过敏史\n"
        "诊断：2型糖尿病\n"
        "检验：空腹血糖 8.1 mmol/L ↑；糖化血红蛋白 7.2 % ↑\n"
        "检验趋势：空腹血糖 8.1→7.2 mmol/L（下降）\n"
        "用药：二甲双胍 0.5 g 口服 bid 当前"
    )
    record = structure_medical_record("SYN-NUMERIC", source)
    summary = build_one_page_summary(record)

    assert "空腹血糖 8.1 mmol/L ↑" in summary
    assert "糖化血红蛋白 7.2 % ↑" in summary
    assert "空腹血糖 8.1→7.2 mmol/L（下降）" in summary
    assert "二甲双胍 0.5 g 口服 bid 当前" in summary
    assert record.laboratory_trend == "空腹血糖 8.1→7.2 mmol/L（下降）"


def test_missing_medication_unit_is_flagged_without_guessing() -> None:
    source = (
        "性别：女\n"
        "主诉：合成测试\n"
        "过敏史：不详\n"
        "诊断：头痛待查\n"
        "用药：布洛芬 200 口服 tid 当前"
    )
    record = structure_medical_record("SYN-MISSING-UNIT", source)

    assert record.medications == ()
    assert "medication unit missing: 布洛芬 200 口服 tid 当前" in record.quality_issues
