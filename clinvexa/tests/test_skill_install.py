from __future__ import annotations

import json
import shutil
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from clinvexa.main import create_app, main
from clinvexa.skills import CatalogError, CLINVEXASkillPlaza, SkillOperationError

PROJECT_ROOT = Path(__file__).parents[2]
CATALOG_PATH = PROJECT_ROOT / "skills" / "clinvexa" / "catalog.json"


def test_installation_time_survives_updates_and_tracks_new_install(tmp_path, monkeypatch):
    plaza = CLINVEXASkillPlaza.from_catalog(CATALOG_PATH, tmp_path / "skills")
    monkeypatch.setattr("clinvexa.skills.time.time", lambda: 1000.0)
    first = plaza.install("record-structuring", "1.0.0")
    assert first.added_at == 1000.0
    monkeypatch.setattr("clinvexa.skills.time.time", lambda: 2000.0)
    assert plaza.switch_version(first.name, "1.1.0").added_at == 1000.0
    assert plaza.disable(first.name).added_at == 1000.0
    assert plaza.enable(first.name).added_at == 1000.0
    assert plaza.install("followup-plan").added_at == 2000.0


def test_builtin_skills_are_browsable_installable_and_loadable_by_hermes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hermes_home = tmp_path / "hermes-home"
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    plaza = CLINVEXASkillPlaza.from_catalog(CATALOG_PATH, hermes_home / "skills")

    assert len(plaza.browse()) == 27
    assert plaza.search("病历")
    assert {skill.scope for skill in plaza.browse()} == {"department", "personal", "platform"}

    for skill in plaza.browse():
        installed = plaza.install(skill.name)
        assert installed.enabled is True
        assert installed.path.joinpath("SKILL.md").is_file()
        invocation = plaza.build_invocation(skill.name, "处理合成材料")
        assert invocation.startswith(f"${skill.name}\nCLINVEXA Skill：")
        assert "任务：处理合成材料" in invocation

    from tools.skills_tool import skills_list

    hermes_skills = json.loads(skills_list())
    installed_names = {skill["name"] for skill in hermes_skills["skills"]}
    assert {skill.name for skill in plaza.browse()} <= installed_names

    plaza.disable("record-structuring")
    disabled_names = {skill["name"] for skill in json.loads(skills_list())["skills"]}
    assert "record-structuring" not in disabled_names
    plaza.enable("record-structuring")
    enabled_names = {skill["name"] for skill in json.loads(skills_list())["skills"]}
    assert "record-structuring" in enabled_names


def test_enable_disable_version_switch_and_uninstall_apply_without_client_reinstall(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    plaza = CLINVEXASkillPlaza.from_catalog(CATALOG_PATH, skills_root)
    installed = plaza.install("record-structuring", "1.0.0")

    plaza.disable(installed.name)
    with pytest.raises(SkillOperationError, match="skill is disabled"):
        plaza.build_invocation(installed.name, "结构化病历")

    plaza.enable(installed.name)
    switched = plaza.switch_version(installed.name, "1.1.0")
    assert switched.version == "1.1.0"
    assert plaza.build_invocation(installed.name, "结构化病历").startswith("$record-structuring\n")

    plaza.uninstall(installed.name)
    assert plaza.list_installed() == ()


def test_one_hundred_install_uninstall_and_version_switch_cycles_leave_no_residue(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    plaza = CLINVEXASkillPlaza.from_catalog(CATALOG_PATH, skills_root)

    for _ in range(100):
        plaza.install("record-structuring", "1.0.0")
        plaza.switch_version("record-structuring", "1.1.0")
        assert len(plaza.list_installed()) == 1
        plaza.uninstall("record-structuring")
        assert plaza.list_installed() == ()

    assert not list(skills_root.rglob("record-structuring"))


def test_installed_catalog_skill_is_refreshed_without_touching_dynamic_skill(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    plaza = CLINVEXASkillPlaza.from_catalog(CATALOG_PATH, skills_root)
    installed = plaza.install("followup-plan", "1.0.0")
    installed.path.joinpath("SKILL.md").write_text("stale", encoding="utf-8")

    dynamic = skills_root / "clinvexa" / "custom-medical-office"
    dynamic.mkdir(parents=True)
    dynamic_skill = """---
name: custom-medical-office
description: A user-created skill that must survive bundled synchronization.
---
# Custom Medical Office
"""
    dynamic.joinpath("SKILL.md").write_text(dynamic_skill, encoding="utf-8")

    refreshed = plaza.synchronize_installed_catalog()

    assert [skill.name for skill in refreshed] == ["followup-plan"]
    assert refreshed[0].version == "1.5.0"
    assert installed.path.joinpath("SKILL.md").read_text(encoding="utf-8") == (
        CATALOG_PATH.parent / "followup-plan" / "SKILL.md"
    ).read_text(encoding="utf-8")
    assert dynamic.joinpath("SKILL.md").read_text(encoding="utf-8") == dynamic_skill


def test_invalid_and_missing_dependency_skills_are_rejected_without_affecting_other_skills(tmp_path: Path) -> None:
    sources = tmp_path / "sources"
    valid = sources / "valid-skill"
    valid.mkdir(parents=True)
    valid.joinpath("SKILL.md").write_text(
        "---\nname: valid-skill\ndescription: valid synthetic skill for dependency testing\n---\n\n# Valid\n",
        encoding="utf-8",
    )
    catalog_path = sources / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            {
                "skills": [
                    {
                        "name": "valid-skill",
                        "title": "Valid",
                        "description": "valid",
                        "scope": "platform",
                        "source": "valid-skill",
                        "default_version": "1.0.0",
                        "versions": ["1.0.0"],
                        "dependencies": ["missing-runtime"],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    plaza = CLINVEXASkillPlaza.from_catalog(catalog_path, tmp_path / "skills")

    with pytest.raises(SkillOperationError, match="missing dependency: missing-runtime"):
        plaza.install("valid-skill")
    assert plaza.list_installed() == ()

    valid.joinpath("SKILL.md").unlink()
    with pytest.raises(CatalogError, match="missing SKILL.md"):
        CLINVEXASkillPlaza.from_catalog(catalog_path, tmp_path / "other-skills")

    valid.joinpath("SKILL.md").write_text(
        "---\nname: wrong-name\ndescription: damaged synthetic skill\n---\n\n# Damaged\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogError, match="SKILL.md name mismatch"):
        CLINVEXASkillPlaza.from_catalog(catalog_path, tmp_path / "other-skills")


def test_skill_plaza_http_api_drives_the_same_hermes_skill_directory(tmp_path: Path) -> None:
    app = create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills")
    client = TestClient(app)

    catalog = client.get("/clinvexa/skills")
    assert catalog.status_code == 200
    assert len(catalog.json()) == 27

    installed = client.post("/clinvexa/skills/record-structuring/install", json={"version": "1.0.0"})
    assert installed.status_code == 200
    assert installed.json()["enabled"] is True

    disabled = client.put("/clinvexa/skills/record-structuring/enabled", json={"enabled": False})
    assert disabled.json()["enabled"] is False
    switched = client.put("/clinvexa/skills/record-structuring/version", json={"version": "1.1.0"})
    assert switched.json()["version"] == "1.1.0"
    assert client.delete("/clinvexa/skills/record-structuring").status_code == 204


def test_skill_plaza_lists_preloaded_catalog_skills_without_install_manifests(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    shutil.copytree(
        CATALOG_PATH.parent / "record-structuring",
        skills_root / "clinvexa" / "record-structuring",
    )
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=skills_root))

    skills = {item["name"]: item for item in client.get("/clinvexa/skills").json()}

    assert skills["record-structuring"]["installed"] is True
    assert skills["record-structuring"]["enabled"] is True
    assert skills["record-structuring"]["version"] == "1.4.0"


def test_agent_created_skill_is_immediately_browsable_and_callable(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    created = skills_root / "clinvexa" / "batch-record-structuring"
    created.mkdir(parents=True)
    created.joinpath("SKILL.md").write_text(
        "---\n"
        "name: batch-record-structuring\n"
        "description: Use when processing multiple medical records.\n"
        "---\n\n"
        "# 批量病历结构化\n\n"
        "逐份结构化病历并汇总供医生复核。\n",
        encoding="utf-8",
    )
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=skills_root))

    skills = {item["name"]: item for item in client.get("/clinvexa/skills").json()}
    invoked = client.post(
        "/clinvexa/skills/batch-record-structuring/invoke",
        json={"task": "处理当前对话中的多份病历"},
    )

    assert skills["batch-record-structuring"].pop("added_at") > 0
    assert skills["batch-record-structuring"] == {
        "default_version": "1.0.0",
        "dependencies": [],
        "description": "Use when processing multiple medical records.",
        "enabled": True,
        "installed": True,
        "name": "batch-record-structuring",
        "scope": "personal",
        "title": "批量病历结构化",
        "version": "1.0.0",
        "versions": ["1.0.0"],
    }
    assert invoked.status_code == 200
    assert "CLINVEXA Skill：批量病历结构化" in invoked.json()["invocation"]
    assert "使用场景与功能：Use when processing multiple medical records." in invoked.json()["invocation"]


def test_skill_manage_creation_in_clinvexa_category_publishes_to_plaza(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from tools.skill_manager_tool import skill_manage

    result = json.loads(
        skill_manage(
            action="create",
            category="clinvexa",
            content=(
                "---\n"
                "name: synthetic-office-check\n"
                "description: Use when checking a medical office draft.\n"
                "---\n\n"
                "# 医疗办公草稿检查\n\n"
                "检查草稿完整性并列出医生复核项。\n"
            ),
            name="synthetic-office-check",
        )
    )
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills"))

    assert result["success"] is True
    assert result["path"] == "clinvexa\\synthetic-office-check"
    skills = {item["name"]: item for item in client.get("/clinvexa/skills").json()}
    assert skills["synthetic-office-check"]["enabled"] is True
    assert client.post(
        "/clinvexa/skills/synthetic-office-check/invoke",
        json={"task": "检查当前草稿"},
    ).status_code == 200


def test_malformed_agent_created_skill_does_not_break_the_catalog(tmp_path: Path) -> None:
    malformed = tmp_path / "skills" / "clinvexa" / "broken-skill"
    malformed.mkdir(parents=True)
    malformed.joinpath("SKILL.md").write_text("not valid frontmatter", encoding="utf-8")
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills"))

    response = client.get("/clinvexa/skills")

    assert response.status_code == 200
    assert len(response.json()) == 27
    assert "broken-skill" not in {item["name"] for item in response.json()}


def test_skill_plaza_http_api_runs_core_medical_skill_deterministically(tmp_path: Path) -> None:
    app = create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills")
    client = TestClient(app)

    missing = client.post("/clinvexa/skills/record-structuring/invoke", json={"task": "结构化病历"})
    assert missing.status_code == 409
    assert missing.json()["detail"] == "skill is not installed: record-structuring"

    client.post("/clinvexa/skills/record-structuring/install", json={"version": "1.0.0"})
    source = tmp_path / "病例.txt"
    source.write_text("患者姓名：张某\n主诉：咳嗽3天", encoding="utf-8")
    invoked = client.post(
        "/clinvexa/skills/record-structuring/invoke",
        json={"source_paths": [str(source)], "task": "结构化病历"},
    )

    assert invoked.status_code == 200
    payload = invoked.json()
    assert payload["mode"] == "deterministic"
    assert payload["processed_sources"] == 1
    assert Path(payload["output_paths"][0]).is_file()
    assert payload["output_paths"][0].endswith("病例_病历结构化.xlsx")


def test_skill_plaza_streams_real_deterministic_progress_and_result(tmp_path: Path) -> None:
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills"))
    client.post("/clinvexa/skills/record-structuring/install", json={"version": "1.4.0"})
    source = tmp_path / "流式病例.txt"
    source.write_text("患者姓名：李某\n主诉：咳嗽3天\n初步判断：急性上呼吸道感染", encoding="utf-8")

    with client.stream(
        "POST",
        "/clinvexa/skills/record-structuring/invoke/stream",
        json={"source_paths": [str(source)], "task": "结构化病历"},
    ) as response:
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert response.status_code == 200
    progress = [event for event in events if event["type"] == "progress"]
    assert [event["event_id"] for event in progress if event["status"] == "complete"] == [
        "receive",
        "read",
        "extract",
        "validate",
        "write",
    ]
    extracted = next(event for event in progress if event["event_id"] == "extract" and event["status"] == "complete")
    assert "流式病例.txt" in extracted["message"]
    assert "已提取" in extracted["message"]
    assert "主诉" in extracted["message"]
    completed = events[-1]
    assert completed["type"] == "complete"
    assert completed["extraction_summary"]["documents"][0]["source"] == "流式病例.txt"
    assert "病历结构化结果" in completed["result_markdown"]
    assert "李某" in completed["result_markdown"]
    assert Path(completed["output_paths"][0]).is_file()


def test_core_medical_skill_requires_an_imported_source(tmp_path: Path) -> None:
    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills"))
    client.post("/clinvexa/skills/followup-plan/install", json={"version": "1.5.0"})

    response = client.post("/clinvexa/skills/followup-plan/invoke", json={"task": "生成随访计划"})

    assert response.status_code == 422
    assert "请先在主对话框中导入" in response.json()["detail"]


def test_clinvexa_service_uses_the_required_working_port(monkeypatch: pytest.MonkeyPatch) -> None:
    import uvicorn

    calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))

    main()

    assert calls == [(('clinvexa.main:create_app',), {'factory': True, 'host': '127.0.0.1', 'port': 8001})]


def test_main_chat_prepare_checks_skill_state_without_running_or_exporting(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path / 'home'))
    with TestClient(create_app()) as client:
        path = '/clinvexa/skills/record-structuring'
        task = {'task': '整理已附病历，保留来源', 'source_paths': []}
        assert client.post(path + '/prepare', json=task).status_code >= 400
        assert client.post(path + '/install', json={'version': '1.0.0'}).status_code == 200
        response = client.post(path + '/prepare', json=task)
        assert response.status_code == 200
        assert '整理已附病历，保留来源' in response.json()['invocation']
        assert 'clinvexa.deterministic_skills record-structuring' in response.json()['invocation']
        assert 'output_paths' not in response.json()
        client.put(path + '/enabled', json={'enabled': False})
        assert client.post(path + '/prepare', json=task).status_code >= 400
