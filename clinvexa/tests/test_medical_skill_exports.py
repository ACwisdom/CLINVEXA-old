from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from clinvexa import deterministic_skills


PROJECT_ROOT = Path(__file__).parents[2]
SKILLS_ROOT = PROJECT_ROOT / "skills" / "clinvexa"
SHEET_NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def _medical_record(name: str, complaint: str, followup: str = "") -> str:
    return "\n".join(
        (
            f"患者姓名：{name}",
            f"主诉：{complaint}",
            "现病史：症状持续，无明显缓解。",
            "既往史：否认高血压、糖尿病。",
            "过敏史：青霉素过敏。",
            "用药史：未规律用药。",
            "检查检验信息：体温37.8℃。",
            "初步判断：急性上呼吸道感染（待医生复核）。",
            "处置建议：注意休息，待医生确认。",
            f"随访计划：{followup}" if followup else "",
            "随访时间：一周后" if followup else "",
            "随访方式：门诊复诊" if followup else "",
        )
    )


def test_record_structuring_folder_creates_one_workbook_without_model_input(tmp_path: Path) -> None:
    source_folder = tmp_path / "批量病历"
    source_folder.mkdir()
    (source_folder / "病例一.txt").write_text(_medical_record("张某", "咳嗽3天"), encoding="utf-8")
    (source_folder / "病例二.txt").write_text(_medical_record("李某", "腹痛1天"), encoding="utf-8")

    result = _run_script(
        SKILLS_ROOT / "record-structuring" / "scripts" / "run.py",
        "--source",
        str(source_folder),
    )

    assert result.returncode == 0, result.stderr
    workbook = Path(result.stdout.strip())
    assert workbook == source_folder / "批量病历_病历结构化汇总.xlsx"
    assert list(source_folder.glob("*.xlsx")) == [workbook]
    assert not list(source_folder.glob("*.csv"))
    assert not list(source_folder.glob("*.json"))
    with ZipFile(workbook) as archive:
        sheets = ET.fromstring(archive.read("xl/workbook.xml")).findall(".//s:sheet", SHEET_NS)
        sheet_text = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
        rows = ET.fromstring(sheet_text).findall(".//s:row", SHEET_NS)
    assert len(sheets) == 1
    assert len(rows) == 3
    assert "张某" in sheet_text and "李某" in sheet_text


def test_record_structuring_does_not_invent_unlabelled_facts(tmp_path: Path) -> None:
    source = tmp_path / "自由文本.txt"
    source.write_text("患者今天来到医院，说自己不太舒服。", encoding="utf-8")

    result = _run_script(SKILLS_ROOT / "record-structuring" / "scripts" / "run.py", "--source", str(source))

    assert result.returncode == 0, result.stderr
    with ZipFile(Path(result.stdout.strip())) as archive:
        sheet_text = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
    assert "原文未涉及，待医生补充" in sheet_text
    assert "needs_review" in sheet_text


def test_record_structuring_preserves_open_workbook_and_saves_versioned_result(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "病例.txt"
    source.write_text(_medical_record("张某", "咳嗽3天"), encoding="utf-8")
    occupied = tmp_path / "病例_病历结构化.xlsx"
    previous_content = "用户正在查看的旧结果".encode("utf-8")
    occupied.write_bytes(previous_content)
    original_replace = deterministic_skills._replace_output

    def simulate_excel_lock(temporary: Path, target: Path) -> None:
        if target == occupied:
            raise PermissionError("simulated Excel lock")
        original_replace(temporary, target)

    monkeypatch.setattr(deterministic_skills, "_replace_output", simulate_excel_lock)
    progress: list[str] = []
    result = deterministic_skills.execute_deterministic_skill(
        "record-structuring", [source], on_progress=lambda event: progress.append(str(event["message"]))
    )

    generated = result.output_paths[0]
    assert generated != occupied
    assert generated.parent == tmp_path
    assert generated.name.startswith("病例_病历结构化_")
    assert occupied.read_bytes() == previous_content
    with ZipFile(generated) as archive:
        assert "张某" in archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
    assert any("正在被 Excel/WPS 使用" in message for message in progress)


def test_outpatient_note_draft_automatically_writes_fixed_nine_fields(tmp_path: Path) -> None:
    source = tmp_path / "问诊记录.txt"
    source.write_text("患者姓名：王某\n主诉：腹痛1天\n过敏史：否认药物过敏", encoding="utf-8")

    result = _run_script(
        SKILLS_ROOT / "outpatient-note-draft" / "scripts" / "run.py",
        "--source",
        str(source),
    )

    assert result.returncode == 0, result.stderr
    target = Path(result.stdout.strip())
    assert target == tmp_path / "问诊记录_门诊病历草稿.txt"
    assert target.read_bytes().startswith(b"\xef\xbb\xbf")
    content = target.read_text(encoding="utf-8-sig")
    for field in ("主诉", "现病史", "既往史", "过敏史", "用药史", "检查检验信息", "初步判断", "处置建议", "随访计划"):
        assert f"{field}：" in content
    assert "现病史：对话未涉及，待医生补充" in content
    assert "requires_human_review: true" in content


def test_followup_plan_automatically_writes_one_txt_for_folder(tmp_path: Path) -> None:
    source_folder = tmp_path / "随访资料"
    source_folder.mkdir()
    (source_folder / "张某.txt").write_text(_medical_record("张某", "咳嗽3天", "一周后门诊复诊"), encoding="utf-8")
    (source_folder / "李某.txt").write_text(_medical_record("李某", "腹痛1天"), encoding="utf-8")

    result = _run_script(SKILLS_ROOT / "followup-plan" / "scripts" / "run.py", "--source", str(source_folder))

    assert result.returncode == 0, result.stderr
    target = Path(result.stdout.strip())
    assert target == source_folder / "随访资料_随访计划草稿汇总.txt"
    content = target.read_text(encoding="utf-8-sig")
    assert "患者标识：张某" in content and "患者标识：李某" in content
    assert "建议时间：一周后" in content
    assert "待医生确定" in content
    assert list(source_folder.glob("*_随访计划草稿汇总.txt")) == [target]


def test_outpatient_note_draft_extracts_natural_doctor_patient_dialogue(tmp_path: Path) -> None:
    source = tmp_path / "自然问诊.txt"
    source.write_text(
        """就诊日期：2026-08-12
患者：王某，女，38岁

医生：今天主要哪里不舒服？
患者：这三天右上腹一阵一阵地痛，吃完油腻的东西以后明显一点。
医生：以前得过什么病或者做过手术吗？
患者：五年前做过剖宫产，其他没什么大病。
医生：有没有药物或者食物过敏？
患者：对磺胺类药物过敏，以前吃了以后身上起疹子。
医生：现在长期吃什么药？
患者：没有长期用药，这两天自己吃过一次铝碳酸镁。
医生：彩超报告怎么写？
患者：胆囊内可见多个强回声，较大的大约八毫米，后方伴声影。胆总管没有扩张。
医生：目前先考虑胆囊结石相关疼痛，但还需要结合查体和检查，最终由接诊医生确认。暂时清淡饮食，如果持续疼痛、出现发热、皮肤发黄或者明显呕吐，需要及时复诊或者就医。一周后带报告复诊。
""",
        encoding="utf-8",
    )

    result = _run_script(SKILLS_ROOT / "outpatient-note-draft" / "scripts" / "run.py", "--source", str(source))

    assert result.returncode == 0, result.stderr
    content = Path(result.stdout.strip()).read_text(encoding="utf-8-sig")
    assert "主诉：这三天右上腹" in content
    assert "既往史：五年前做过剖宫产" in content
    assert "过敏史：对磺胺类药物过敏" in content
    assert "用药史：没有长期用药" in content
    assert "检查检验信息：胆囊内可见多个强回声" in content
    assert "初步判断：目前先考虑胆囊结石相关疼痛" in content
    assert "处置建议：暂时清淡饮食" in content
    assert "随访计划：如果持续疼痛" in content and "一周后带报告复诊" in content


def test_followup_plan_extracts_explicit_section_requirements(tmp_path: Path) -> None:
    source = tmp_path / "自然随访.txt"
    source.write_text(
        """患者姓名：李华
就诊日期：2026-08-12

本次就诊信息：
患者因“咳嗽3天，伴低热1天”就诊。
体温37.8℃，血氧饱和度98%。
血常规提示白细胞10.8×10^9/L，报告标记轻度升高。

医生初步判断：
急性上呼吸道感染，待医生结合后续病情复核。

本次处置：
1. 注意休息和补液。
2. 每日早晚监测体温。

医生明确的随访要求：
1. 3天后通过门诊复诊。
2. 复诊时观察咳嗽、发热和呼吸情况。
3. 复诊时复查血常规和C反应蛋白。
4. 如果持续高热、出现胸痛、明显气促或症状明显加重，应提前就医。

患者限制：
患者表示工作日白天不方便接听电话。
""",
        encoding="utf-8",
    )

    result = _run_script(SKILLS_ROOT / "followup-plan" / "scripts" / "run.py", "--source", str(source))

    assert result.returncode == 0, result.stderr
    content = Path(result.stdout.strip()).read_text(encoding="utf-8-sig")
    assert "当前病情摘要：咳嗽3天，伴低热1天" in content
    assert "初步判断：急性上呼吸道感染" in content
    assert "已记录处置：注意休息和补液" in content
    assert "建议时间：3天后" in content
    assert "随访方式：门诊复诊" in content
    assert "观察项目：复诊时观察咳嗽、发热和呼吸情况" in content
    assert "复查项目：复诊时复查血常规和C反应蛋白" in content
    assert "异常触发条件：如果持续高热" in content
    assert "患者相关限制：患者表示工作日白天不方便接听电话" in content
