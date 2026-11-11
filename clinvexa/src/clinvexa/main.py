"""CLINVEXA local service entry point."""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Iterator

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from clinvexa.consultations import (
    ConsultationError,
    ConsultationService,
    MarkerLabel,
    consultation_payload,
)
from clinvexa.deterministic_skills import (
    DETERMINISTIC_SKILLS,
    DeterministicSkillError,
    execute_deterministic_skill,
)
from clinvexa.rpa import (
    DoctorConfirmation,
    RpaSafetyError,
    RpaStateMachine,
    RpaTask,
    load_cua_rpa_machine,
)
from clinvexa.skills import CLINVEXASkillPlaza, SkillOperationError

logger = logging.getLogger(__name__)


class VersionRequest(BaseModel):
    """Request one catalog Skill version."""

    version: str | None = None


class EnabledRequest(BaseModel):
    """Request an installed Skill enabled state."""

    enabled: bool


class SkillInvokeRequest(BaseModel):
    """Request one executable CLINVEXA Skill invocation."""

    task: str
    source_paths: list[str] = Field(default_factory=list)


class RpaPrepareRequest(BaseModel):
    """Request one patient-bound HIS draft preparation."""

    expected_patient_id: str
    expected_window_id: str
    fields: dict[str, str]
    task_id: str


class RpaConfirmRequest(BaseModel):
    """Request one explicit doctor confirmation for a prepared HIS draft."""

    doctor_id: str
    patient_id: str
    window_id: str


class ConsultationStartRequest(BaseModel):
    """Request a patient-bound consultation recording session."""

    consent_confirmed: bool
    patient_id: str
    patient_name: str = ""
    dialect: str = "auto"


class ConsultationMarkerRequest(BaseModel):
    """Request one non-blocking marker on the recording timeline."""

    label: MarkerLabel
    note: str = ""
    offset_ms: int


def create_app(
    catalog_path: Path | None = None,
    skills_root: Path | None = None,
    rpa_machine: RpaStateMachine | None = None,
    consultation_service: ConsultationService | None = None,
) -> FastAPI:
    """Create the CLINVEXA local HTTP service.

    Args:
        catalog_path: Optional catalog override used by tests and packaged deployments.
        skills_root: Optional Hermes Skills directory override.
        rpa_machine: Optional patient-bound HIS RPA runtime.

    Returns:
        Configured FastAPI application.
    """
    if catalog_path is None:
        catalog_path = Path(__file__).resolve().parents[3] / "skills" / "clinvexa" / "catalog.json"
    if skills_root is None:
        from hermes_constants import get_hermes_home

        skills_root = get_hermes_home() / "skills"
    if rpa_machine is None and (rpa_config := os.environ.get("CLINVEXA_RPA_CONFIG")):
        from tools.computer_use.tool import _get_backend

        try:
            rpa_machine = load_cua_rpa_machine(Path(rpa_config), _get_backend("clinvexa-rpa"))
        except RuntimeError:
            logger.error("failed to initialize HIS RPA; continuing without the tool", exc_info=True)
    if consultation_service is None:
        from hermes_constants import get_hermes_home

        consultation_service = ConsultationService(get_hermes_home() / "clinvexa" / "consultations")
    plaza = CLINVEXASkillPlaza.from_catalog(catalog_path, skills_root)
    refreshed_skills = plaza.synchronize_installed_catalog()
    if refreshed_skills:
        logger.info(
            "synchronized %d installed CLINVEXA Skills from packaged Source A: %s",
            len(refreshed_skills),
            ", ".join(skill.name for skill in refreshed_skills),
        )
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        from clinvexa.live_asr import warmup
        Thread(target=warmup, name="clinvexa-live-asr-warmup", daemon=True).start()
        yield

    app = FastAPI(title="CLINVEXA", version="0.1.0", lifespan=lifespan)

    @app.get("/clinvexa/health")
    def service_health():
        return {"status": "ok", "consultation_contract": 2, "skills_mentions_contract": 1}
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5174", "http://localhost:5174", "null"],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["content-type"],
    )

    @app.get("/clinvexa/voice/status")
    def live_voice_status(dialect: str = Query("auto", pattern="^(auto|zh|yue|shanghai|beijing)$")) -> dict:
        from clinvexa.live_asr import status as asr_status
        return asr_status(dialect)

    @app.post("/clinvexa/voice/warmup")
    def prepare_voice(dialect: str = Query("auto", pattern="^(auto|zh|yue|shanghai|beijing)$")):
        from clinvexa.live_asr import warmup, status as asr_status
        readiness = asr_status(dialect)
        if readiness['installed'] and not readiness['ready'] and not readiness['loading']:
            Thread(target=warmup, args=(dialect,), daemon=True, name="clinvexa-dialect-warmup").start()
        return asr_status(dialect)

    @app.get("/clinvexa/simulated-his", response_class=FileResponse)
    def simulated_his() -> FileResponse:
        simulator_path = Path(__file__).resolve().parents[3] / "deploy" / "clinvexa" / "simulated-his" / "index.html"
        return FileResponse(simulator_path, media_type="text/html")

    @app.get("/clinvexa/skills")
    def list_skills() -> list[dict[str, object]]:
        installed = {item.name: item for item in plaza.list_installed()}
        return [
            {
                "default_version": skill.default_version,
                "dependencies": skill.dependencies,
                "description": skill.description,
                "enabled": installed.get(skill.name).enabled if skill.name in installed else False,
                "installed": skill.name in installed,
                "added_at": installed[skill.name].added_at if skill.name in installed else None,
                "name": skill.name,
                "scope": skill.scope,
                "title": skill.title,
                "version": installed.get(skill.name).version if skill.name in installed else None,
                "versions": skill.versions,
            }
            for skill in plaza.browse()
        ]

    @app.post("/clinvexa/skills/{name}/install")
    def install_skill(name: str, body: VersionRequest) -> dict[str, object]:
        return _installed_payload(_call(lambda: plaza.install(name, body.version)))

    @app.put("/clinvexa/skills/{name}/enabled")
    def set_skill_enabled(name: str, body: EnabledRequest) -> dict[str, object]:
        operation = plaza.enable if body.enabled else plaza.disable
        return _installed_payload(_call(lambda: operation(name)))

    @app.put("/clinvexa/skills/{name}/version")
    def switch_skill_version(name: str, body: VersionRequest) -> dict[str, object]:
        if not body.version:
            raise HTTPException(status_code=400, detail="version is required")
        return _installed_payload(_call(lambda: plaza.switch_version(name, body.version or "")))

    @app.delete("/clinvexa/skills/{name}", status_code=status.HTTP_204_NO_CONTENT)
    def uninstall_skill(name: str) -> Response:
        _call(lambda: plaza.uninstall(name))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/clinvexa/skills/{name}/prepare")
    def prepare_skill(name: str, body: SkillInvokeRequest) -> dict:
        # Validate installed/enabled state before adding the explicit invocation
        # to a main-chat turn. Execution remains in the existing skill runner.
        return {"invocation": _call(lambda: plaza.build_invocation(name, body.task))}

    @app.post("/clinvexa/skills/{name}/invoke")
    def invoke_skill(name: str, body: SkillInvokeRequest) -> Response:
        invocation = _call(lambda: plaza.build_invocation(name, body.task))
        if name in DETERMINISTIC_SKILLS:
            result = _call_deterministic(
                lambda: execute_deterministic_skill(name, body.source_paths)
            )
            output_paths = [str(path) for path in result.output_paths]
            return Response(
                content=json.dumps(
                    {
                        "mode": "deterministic",
                        "output_paths": output_paths,
                        "processed_sources": result.processed_sources,
                        "result_markdown": result.result_markdown,
                        "extraction_summary": result.extraction_summary,
                        "message": f"固定脚本执行完成。结果文件：{output_paths[0]}",
                    },
                    ensure_ascii=False,
                ),
                media_type="application/json; charset=utf-8",
            )
        return Response(
            content=json.dumps({"mode": "agent", "invocation": invocation}, ensure_ascii=False),
            media_type="application/json; charset=utf-8",
        )

    @app.post("/clinvexa/skills/{name}/invoke/stream")
    def stream_skill(name: str, body: SkillInvokeRequest) -> StreamingResponse:
        """Stream actual deterministic Skill stages as newline-delimited JSON."""
        invocation = _call(lambda: plaza.build_invocation(name, body.task))

        def event_stream() -> Iterator[str]:
            if name not in DETERMINISTIC_SKILLS:
                yield _json_line({"invocation": invocation, "mode": "agent", "type": "agent"})
                return

            events: Queue[dict[str, object] | None] = Queue()

            def worker() -> None:
                try:
                    result = execute_deterministic_skill(name, body.source_paths, on_progress=events.put)
                    events.put(
                        {
                            "mode": "deterministic",
                            "output_paths": [str(path) for path in result.output_paths],
                            "processed_sources": result.processed_sources,
                            "result_markdown": result.result_markdown,
                            "extraction_summary": result.extraction_summary,
                            "type": "complete",
                        }
                    )
                except DeterministicSkillError as exc:
                    events.put({"message": str(exc), "type": "error"})
                except Exception:
                    logger.exception("deterministic Skill stream failed: %s", name)
                    events.put({"message": "确定性 Skill 执行异常，请查看 CLINVEXA 本地服务日志", "type": "error"})
                finally:
                    events.put(None)

            Thread(target=worker, name=f"clinvexa-skill-{name}", daemon=True).start()
            while (event := events.get()) is not None:
                yield _json_line(event)

        return StreamingResponse(event_stream(), media_type="application/x-ndjson; charset=utf-8")

    @app.post("/clinvexa/consultations")
    def start_consultation(body: ConsultationStartRequest) -> dict[str, object]:
        record = _call_consultation(
            lambda: consultation_service.start(
                dialect=body.dialect,
                patient_id=body.patient_id,
                patient_name=body.patient_name,
                consent_confirmed=body.consent_confirmed,
            )
        )
        return consultation_payload(record)

    @app.get("/clinvexa/consultations")
    def recent_consultations() -> list[dict[str, object]]:
        return consultation_service.recent()

    @app.put("/clinvexa/consultations/{consultation_id}/draft")
    def save_consultation_draft(consultation_id: str, draft: str = Body(..., max_length=50000),
                               revision: int = Body(..., ge=0)) -> dict[str, object]:
        return consultation_payload(_call_consultation(lambda: consultation_service.save_doctor_draft(
            consultation_id, draft=draft, revision=revision)))

    @app.get("/clinvexa/consultations/{consultation_id}")
    def get_consultation(consultation_id: str) -> dict[str, object]:
        return consultation_payload(_call_consultation(lambda: consultation_service.get(consultation_id)))

    @app.post("/clinvexa/consultations/{consultation_id}/markers")
    def add_consultation_marker(
        consultation_id: str,
        body: ConsultationMarkerRequest,
    ) -> dict[str, object]:
        record = _call_consultation(
            lambda: consultation_service.add_marker(
                consultation_id,
                label=body.label,
                offset_ms=body.offset_ms,
                note=body.note,
            )
        )
        return consultation_payload(record)

    @app.post("/clinvexa/consultations/{consultation_id}/segments/{sequence}")
    def append_consultation_audio(consultation_id: str, sequence: int, audio: bytes = Body(...)) -> dict[str, object]:
        return consultation_payload(_call_consultation(lambda: consultation_service.append_audio(
            consultation_id, sequence=sequence, audio=audio)))

    @app.post("/clinvexa/consultations/{consultation_id}/complete")
    def complete_consultation_stream(consultation_id: str, segment_count: int = Query(..., ge=0),
                                    duration_ms: int = Query(..., gt=0)) -> dict[str, object]:
        return consultation_payload(_call_consultation(lambda: consultation_service.finish_stream(
            consultation_id, segment_count=segment_count, duration_ms=duration_ms)))

    @app.post("/clinvexa/consultations/{consultation_id}/recover")
    def recover_consultation_audio(consultation_id: str):
        return consultation_payload(_call_consultation(lambda: consultation_service.recover_audio(consultation_id)))

    @app.post("/clinvexa/consultations/{consultation_id}/analysis")
    def analyze_consultation(consultation_id: str):
        _call_consultation(lambda: consultation_service.get(consultation_id))
        def events():
            for item in consultation_service.analyze_stream(consultation_id):
                yield json.dumps(item, ensure_ascii=False) + "\n"
        return StreamingResponse(events(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @app.put("/clinvexa/consultations/{consultation_id}/transcript")
    def correct_consultation_transcript(consultation_id: str, text: str = Body(..., max_length=50000),
                                       segment_count: int = Body(..., ge=0)):
        return consultation_payload(_call_consultation(lambda: consultation_service.correct_transcript(
            consultation_id, text=text, segment_count=segment_count)))

    @app.post("/clinvexa/consultations/{consultation_id}/finish")
    def finish_consultation(
        consultation_id: str,
        request: Request,
        audio: bytes = Body(...),
        duration_ms: int = Query(..., gt=0),
    ) -> dict[str, object]:
        record = _call_consultation(
            lambda: consultation_service.finish(
                consultation_id,
                audio=audio,
                content_type=request.headers.get("content-type", "audio/webm"),
                duration_ms=duration_ms,
            )
        )
        return consultation_payload(record)

    @app.post("/clinvexa/rpa/tasks/prepare")
    def prepare_rpa_task(body: RpaPrepareRequest) -> dict[str, object]:
        machine = _require_rpa(rpa_machine)
        run = _call_rpa(
            lambda: machine.prepare(
                RpaTask(
                    expected_patient_id=body.expected_patient_id,
                    expected_window_id=body.expected_window_id,
                    fields=body.fields,
                    task_id=body.task_id,
                )
            )
        )
        return _rpa_payload(run)

    @app.post("/clinvexa/rpa/tasks/{task_id}/confirm")
    def confirm_rpa_task(task_id: str, body: RpaConfirmRequest) -> dict[str, object]:
        machine = _require_rpa(rpa_machine)
        run = _call_rpa(
            lambda: machine.submit(
                task_id,
                DoctorConfirmation(
                    doctor_id=body.doctor_id,
                    patient_id=body.patient_id,
                    task_id=task_id,
                    window_id=body.window_id,
                ),
            )
        )
        return _rpa_payload(run)

    return app


def main() -> None:
    """Run the CLINVEXA local service on the configured working port."""
    import uvicorn
    from hermes_cli.env_loader import load_hermes_dotenv

    # This is a sibling process of the gateway, with its own environment.
    load_hermes_dotenv()

    uvicorn.run("clinvexa.main:create_app", factory=True, host="127.0.0.1", port=8001)


def _call(operation):
    try:
        return operation()
    except SkillOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _call_deterministic(operation):
    try:
        return operation()
    except DeterministicSkillError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _json_line(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def _installed_payload(installed) -> dict[str, object]:
    return {
        "enabled": installed.enabled,
        "name": installed.name,
        "version": installed.version,
    }


def _call_rpa(operation):
    try:
        return operation()
    except RpaSafetyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _call_consultation(operation):
    try:
        return operation()
    except ConsultationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _require_rpa(machine: RpaStateMachine | None) -> RpaStateMachine:
    if machine is None:
        raise HTTPException(status_code=503, detail="当前环境无该工具可调用")
    return machine


def _rpa_payload(run) -> dict[str, object]:
    return {
        "failure_reason": run.failure_reason,
        "state": run.state.value,
        "task_id": run.task_id,
    }


if __name__ == "__main__":
    main()
