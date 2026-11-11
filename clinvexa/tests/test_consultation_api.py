from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from clinvexa.consultations import ConsultationService
from clinvexa.main import create_app

PROJECT_ROOT = Path(__file__).parents[2]
CATALOG_PATH = PROJECT_ROOT / "skills" / "clinvexa" / "catalog.json"


def test_consultation_api_completes_recording_to_review_draft(tmp_path: Path) -> None:
    service = ConsultationService(
        tmp_path / "consultations",
        lambda _: {
            "success": True,
            "transcript": "主诉：腹痛一天。现病史：今天晨起出现上腹痛。过敏史：青霉素过敏。",
        },
        lambda transcript: {"consultation_record": f"医生：请描述病情。\n{transcript}"},
    )
    client = TestClient(
        create_app(
            catalog_path=CATALOG_PATH,
            consultation_service=service,
            skills_root=tmp_path / "skills",
        )
    )

    started = client.post(
        "/clinvexa/consultations",
        json={"patient_id": "P-API", "patient_name": "合成患者", "consent_confirmed": True},
    )
    assert started.status_code == 200
    consultation_id = started.json()["id"]

    marked = client.post(
        f"/clinvexa/consultations/{consultation_id}/markers",
        json={"label": "important", "offset_ms": 4_200, "note": "腹痛位置需要复核"},
    )
    assert marked.status_code == 200
    assert marked.json()["marker_titles"][0]["title"] == "重点内容"

    finished = client.post(
        f"/clinvexa/consultations/{consultation_id}/finish?duration_ms=12000",
        content=b"synthetic-audio",
        headers={"content-type": "audio/webm"},
    )
    assert finished.status_code == 200
    payload = finished.json()
    assert payload["status"] == "ready"
    assert payload["analysis_mode"] == "ai"
    assert payload["raw_transcript"].startswith("主诉：腹痛一天")
    assert payload["draft"]["chief_complaint"] == "腹痛一天"
    assert payload["draft"]["requires_human_review"] is True
    assert payload["draft_schema_version"] == "clinvexa.consultation-draft.v1"
    assert payload["draft_language"] == "zh-CN"
    assert len(payload["draft_fields"]) == 9
    assert payload["draft_fields"][0] == {
        "key": "chief_complaint",
        "title": "主诉",
        "value": "腹痛一天",
        "status": "present",
        "source_evidence": "腹痛一天",
    }
    assert payload["draft_fields"][4]["status"] == "not_mentioned"
    assert payload["draft_fields"][4]["value"] == "对话未涉及，待医生补充"
    assert "必须经医生复核" in payload["draft_text"]

    loaded = client.get(f"/clinvexa/consultations/{consultation_id}")
    assert loaded.status_code == 200
    assert loaded.json()["transcript"] == payload["transcript"]
