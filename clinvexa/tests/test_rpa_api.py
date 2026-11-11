from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from clinvexa.main import create_app
from clinvexa.rpa import HisSnapshot, RpaStateMachine, SimulatedHisAdapter

PROJECT_ROOT = Path(__file__).parents[2]
CATALOG_PATH = PROJECT_ROOT / "skills" / "clinvexa" / "catalog.json"


def test_rpa_api_prepares_draft_then_requires_explicit_confirmation(tmp_path: Path) -> None:
    adapter = SimulatedHisAdapter(
        HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://api",
            window_id="his-main",
        )
    )
    machine = RpaStateMachine(adapter, journal_path=tmp_path / "rpa-state.json")
    app = create_app(
        catalog_path=CATALOG_PATH,
        rpa_machine=machine,
        skills_root=tmp_path / "skills",
    )
    client = TestClient(app)

    prepared = client.post(
        "/clinvexa/rpa/tasks/prepare",
        json={
            "expected_patient_id": "SYN-P001",
            "expected_window_id": "his-main",
            "fields": {"chief_complaint": "合成测试主诉"},
            "task_id": "task-api",
        },
    )

    assert prepared.status_code == 200
    assert prepared.json() == {
        "failure_reason": None,
        "state": "awaiting_confirmation",
        "task_id": "task-api",
    }
    assert adapter.submit_count == 0

    submitted = client.post(
        "/clinvexa/rpa/tasks/task-api/confirm",
        json={
            "doctor_id": "doctor-001",
            "patient_id": "SYN-P001",
            "window_id": "his-main",
        },
    )

    assert submitted.status_code == 200
    assert submitted.json()["state"] == "submitted"
    assert adapter.submit_count == 1


def test_rpa_api_reports_exact_unavailable_message_when_his_is_not_configured(tmp_path: Path) -> None:
    app = create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills")
    client = TestClient(app)

    response = client.post(
        "/clinvexa/rpa/tasks/prepare",
        json={
            "expected_patient_id": "SYN-P001",
            "expected_window_id": "his-main",
            "fields": {"chief_complaint": "合成测试主诉"},
            "task_id": "task-unavailable",
        },
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "当前环境无该工具可调用"}


def test_unavailable_cua_driver_does_not_block_skill_plaza(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CLINVEXA_RPA_CONFIG", str(tmp_path / "his-rpa.json"))

    def raise_unavailable(_: str) -> None:
        raise RuntimeError("cua-driver is not installed")

    monkeypatch.setattr("tools.computer_use.tool._get_backend", raise_unavailable)

    client = TestClient(create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills"))

    assert len(client.get("/clinvexa/skills").json()) == 27
    response = client.post(
        "/clinvexa/rpa/tasks/prepare",
        json={
            "expected_patient_id": "SYN-P001",
            "expected_window_id": "his-main",
            "fields": {"chief_complaint": "合成测试主诉"},
            "task_id": "task-driver-unavailable",
        },
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "当前环境无该工具可调用"}


def test_simulated_his_is_served_by_the_clinvexa_service(tmp_path: Path) -> None:
    app = create_app(catalog_path=CATALOG_PATH, skills_root=tmp_path / "skills")
    response = TestClient(app).get("/clinvexa/simulated-his")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="patient_search"' in response.text
    assert 'id="open_patient"' in response.text
    assert 'id="submit_record"' in response.text
