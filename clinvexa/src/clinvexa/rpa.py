"""Safety-first HIS RPA state machine and deterministic acceptance adapter."""

from __future__ import annotations

import json
import os
import unicodedata
from hashlib import sha256
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Mapping, Protocol
from uuid import uuid4

from tools.computer_use.backend import ActionResult, CaptureResult, UIElement


class RpaSafetyError(RuntimeError):
    """Report a stopped or disallowed HIS RPA operation."""


class CuaBackend(Protocol):
    """Describe the Hermes computer-use calls required by the HIS adapter."""

    def capture(self, **kwargs: object) -> CaptureResult:
        """Capture one accessibility and screenshot snapshot."""

    def set_value(self, value: str, element: int | None = None) -> ActionResult:
        """Set one native accessibility element value."""

    def click(
        self,
        *,
        element: int | None = None,
        x: int | None = None,
        y: int | None = None,
        **kwargs: object,
    ) -> ActionResult:
        """Click one UIA element or verified fallback coordinate."""

    def type_text(self, text: str, **kwargs: object) -> ActionResult:
        """Type text after a verified fallback click."""

    def key(self, keys: str, **kwargs: object) -> ActionResult:
        """Send a keyboard shortcut to the captured HIS window."""


class RpaState(StrEnum):
    """Represent the externally visible state of one HIS RPA task."""

    AWAITING_CONFIRMATION = "awaiting_confirmation"
    STOPPED = "stopped"
    SUBMITTED = "submitted"


@dataclass(frozen=True, slots=True)
class HisSnapshot:
    """Describe the HIS window state observed before an RPA action."""

    controls: frozenset[str]
    patient_id: str
    screenshot_ref: str
    window_id: str
    blocking_popup: bool = False


@dataclass(frozen=True, slots=True)
class RpaTask:
    """Describe a patient-bound HIS draft task."""

    expected_patient_id: str
    expected_window_id: str
    fields: Mapping[str, str]
    task_id: str


@dataclass(frozen=True, slots=True)
class DoctorConfirmation:
    """Bind one explicit doctor confirmation to a patient, task, and window."""

    doctor_id: str
    patient_id: str
    task_id: str
    window_id: str


@dataclass(frozen=True, slots=True)
class RpaRun:
    """Expose the current state of one HIS RPA task."""

    state: RpaState
    task_id: str
    failure_reason: str | None = None


@dataclass(frozen=True, slots=True)
class RpaAuditEntry:
    """Record one patient-bound RPA step and its screenshot evidence."""

    result: str
    screenshot_ref: str
    step: str
    failure_reason: str | None = None


@dataclass(frozen=True, slots=True)
class CuaControlLocator:
    """Locate one HIS control by UIA id with an optional pixel fallback."""

    automation_id: str
    fallback_coordinate: tuple[int, int] | None = None


class HermesCuaHisAdapter:
    """Adapt the existing Hermes computer-use backend to patient-bound HIS actions."""

    def __init__(
        self,
        app: str,
        backend: CuaBackend,
        controls: Mapping[str, CuaControlLocator],
        patient_automation_id: str,
    ) -> None:
        """Capture the target HIS window and resolve its configured UIA controls."""
        self._app = app
        self._backend = backend
        self._controls = dict(controls)
        self._patient_automation_id = patient_automation_id
        self._capture = backend.capture(app=app, mode="som")
        self.snapshot = self._snapshot_from_capture()

    def refresh(self) -> HisSnapshot:
        """Recapture the current HIS window and its accessibility tree."""
        self._capture = self._backend.capture(app=self._app, mode="som")
        self.snapshot = self._snapshot_from_capture()
        return self.snapshot

    def _snapshot_from_capture(self) -> HisSnapshot:
        patient = self._element_by_automation_id(self._patient_automation_id)
        patient_id = ""
        if patient is not None:
            patient_id = str(patient.attributes.get("value") or patient.label)
        resolved = frozenset(
            name
            for name, locator in self._controls.items()
            if self._element_by_automation_id(locator.automation_id) is not None
            or (self._capture.png_b64 is not None and locator.fallback_coordinate is not None)
        )
        screenshot_source = self._capture.png_b64 or ""
        screenshot_ref = f"cua://{sha256(screenshot_source.encode()).hexdigest()[:16]}"
        blocking_popup = any(
            "dialog" in element.role.casefold()
            or element.attributes.get("modal") is True
            or str(element.attributes.get("modal", "")).casefold() == "true"
            for element in self._capture.elements
        )
        return HisSnapshot(
            blocking_popup=blocking_popup,
            controls=resolved,
            patient_id=patient_id,
            screenshot_ref=screenshot_ref,
            window_id=self._capture.window_title,
        )

    def write_field(self, name: str, value: str) -> None:
        """Write and verify one field with a bounded recovery ladder.

        The normal path is a snapshot-bound native ``set_value``. If the
        browser invalidates that snapshot, CLINVEXA re-captures and retries.
        A final foreground path focuses the same verified control, selects its
        current content, types once, and requires UIA read-back when exposed.
        """
        locator = self._controls.get(name)
        if locator is None:
            raise RpaSafetyError(f"control is missing: {name}")
        last_reason = f"field write is unverified: {name}"

        # Two native attempts cover both a normal write and one stale-snapshot
        # recovery without asking the user to repeat the instruction.
        for _attempt in range(2):
            element = self._element_by_automation_id(locator.automation_id)
            if element is not None:
                result = self._backend.set_value(value, element=element.index)
                if self._write_is_confirmed(name, value, result):
                    return
                last_reason = result.code or result.message or last_reason
            self.refresh()

        # Browser text areas sometimes expose read-only value patterns to UIA.
        # Use a foreground keyboard fallback against the freshly captured,
        # explicitly resolved control; never type into an implicit window.
        element = self._element_by_automation_id(locator.automation_id)
        if element is not None:
            click_result = self._backend.click(
                element=element.index,
                bring_to_front=True,
                delivery_mode="foreground",
            )
        elif self._capture.png_b64 is not None and locator.fallback_coordinate is not None:
            x, y = locator.fallback_coordinate
            click_result = self._backend.click(
                x=x,
                y=y,
                bring_to_front=True,
                delivery_mode="foreground",
            )
        else:
            raise RpaSafetyError(f"control is missing: {name}")
        if not click_result.ok or click_result.verified is False:
            raise RpaSafetyError(f"control focus is unverified: {name}")

        key_fn = getattr(self._backend, "key", None)
        if callable(key_fn):
            select_result = key_fn("ctrl+a", delivery_mode="foreground", bring_to_front=True)
            if not select_result.ok or select_result.verified is False:
                raise RpaSafetyError(f"field clear is unverified: {name}")
        type_result = self._backend.type_text(
            value,
            delivery_mode="foreground",
            bring_to_front=True,
        )
        if not self._write_is_confirmed(name, value, type_result):
            reason = type_result.code or type_result.message or last_reason
            raise RpaSafetyError(f"field write is unverified: {name} ({reason})")

    @staticmethod
    def _normalise_value(value: str) -> str:
        """Normalise harmless display differences for HIS read-back checks."""

        return unicodedata.normalize("NFKC", value).replace("\r\n", "\n").strip()

    def _write_is_confirmed(self, name: str, expected: str, result: ActionResult) -> bool:
        """Accept only a successful action plus positive/available read-back."""

        if not result.ok or result.verified is False or result.effect == "suspected_noop":
            return False
        self.refresh()
        actual = self.read_field(name)
        if actual is None:
            # Some native controls expose no ValuePattern. In that case an
            # explicit verified driver verdict is the strongest available
            # evidence; unknown/unverifiable actions continue to recovery.
            return result.verified is True
        return self._normalise_value(actual) == self._normalise_value(expected)

    def read_field(self, name: str) -> str | None:
        """Read the currently captured UIA value when the HIS exposes it."""

        locator = self._controls.get(name)
        if locator is None:
            return None
        element = self._element_by_automation_id(locator.automation_id)
        if element is None or "value" not in element.attributes:
            return None
        return str(element.attributes.get("value") or "")

    def open_patient(self, patient_id: str) -> None:
        """Open one patient from a neutral HIS search view."""
        self.write_field("patient_search", patient_id)
        locator = self._controls.get("open_patient")
        if locator is None:
            raise RpaSafetyError("control is missing: open_patient")
        element = self._element_by_automation_id(locator.automation_id)
        if element is not None:
            result = self._backend.click(element=element.index, bring_to_front=True)
        elif self._capture.png_b64 is not None and locator.fallback_coordinate is not None:
            x, y = locator.fallback_coordinate
            result = self._backend.click(x=x, y=y, bring_to_front=True)
        else:
            raise RpaSafetyError("control is missing: open_patient")
        if not result.ok or result.verified is False:
            raise RpaSafetyError("open patient click is unverified")

    def submit(self) -> None:
        """Click the configured formal-submit control through UIA."""
        locator = self._controls.get("submit")
        if locator is None:
            raise RpaSafetyError("control is missing: submit")
        element = self._element_by_automation_id(locator.automation_id)
        if element is None:
            raise RpaSafetyError("control is missing: submit")
        result = self._backend.click(element=element.index, bring_to_front=True)
        if not result.ok or result.verified is False:
            raise RpaSafetyError("submit click is unverified")

    def _element_by_automation_id(self, automation_id: str) -> UIElement | None:
        return next(
            (
                element
                for element in self._capture.elements
                if element.attributes.get("automation_id") == automation_id
            ),
            None,
        )


class SimulatedHisAdapter:
    """Provide a deterministic non-production HIS target for acceptance tests."""

    def __init__(self, snapshot: HisSnapshot) -> None:
        """Initialize a simulated HIS window from an explicit snapshot."""
        self.snapshot = snapshot
        self.opened_patients: list[str] = []
        self.submit_count = 0
        self.values: dict[str, str] = {}

    def write_field(self, name: str, value: str) -> None:
        """Write one draft value into an available simulated control."""
        if name not in self.snapshot.controls:
            raise RpaSafetyError(f"control is missing: {name}")
        self.values[name] = value

    def read_field(self, name: str) -> str | None:
        """Return the simulator value for post-write verification."""

        return self.values.get(name)

    def refresh(self) -> HisSnapshot:
        """Return the current deterministic simulator snapshot."""
        return self.snapshot

    def open_patient(self, patient_id: str) -> None:
        """Open one synthetic patient from an empty search view."""
        if "patient_search" not in self.snapshot.controls or "open_patient" not in self.snapshot.controls:
            raise RpaSafetyError("patient search controls are missing")
        self.opened_patients.append(patient_id)
        self.snapshot = replace(self.snapshot, patient_id=patient_id)

    def submit(self) -> None:
        """Record one simulated formal HIS submission."""
        self.submit_count += 1


class HisAdapter(Protocol):
    """Describe the patient-bound operations required by the RPA state machine."""

    snapshot: HisSnapshot

    def refresh(self) -> HisSnapshot:
        """Return a fresh HIS context snapshot."""

    def write_field(self, name: str, value: str) -> None:
        """Write one draft field."""

    def read_field(self, name: str) -> str | None:
        """Read one field when the HIS accessibility layer exposes its value."""

    def open_patient(self, patient_id: str) -> None:
        """Open one patient from a neutral search view."""

    def submit(self) -> None:
        """Perform one formal submit action."""


class RpaStateMachine:
    """Prepare HIS drafts while keeping formal submission confirmation-gated."""

    def __init__(self, adapter: HisAdapter, journal_path: Path | None = None) -> None:
        """Initialize the state machine and restore its optional durable journal."""
        self._adapter = adapter
        self._audit_log: list[RpaAuditEntry] = []
        self._journal_path = journal_path
        self._run: RpaRun | None = None
        self._task: RpaTask | None = None
        if journal_path is not None and journal_path.is_file():
            self._restore()

    def prepare(self, task: RpaTask) -> RpaRun:
        """Fill a draft and stop at the mandatory doctor-confirmation boundary."""
        self._task = task
        snapshot = self._adapter.refresh()
        if (
            snapshot.window_id == task.expected_window_id
            and not snapshot.blocking_popup
            and not snapshot.patient_id
        ):
            try:
                self._adapter.open_patient(task.expected_patient_id)
                self._audit_log.append(RpaAuditEntry("ok", snapshot.screenshot_ref, "open_patient"))
                snapshot = self._adapter.refresh()
            except Exception as exc:
                reason = "open patient failed"
                self._stop(task.task_id, reason, snapshot)
                raise RpaSafetyError(reason) from exc
        reason: str | None = None
        if snapshot.window_id != task.expected_window_id:
            reason = "window changed"
        elif snapshot.patient_id != task.expected_patient_id:
            reason = "patient mismatch"
        elif snapshot.blocking_popup:
            reason = "blocking popup"
        else:
            missing = next((name for name in task.fields if name not in snapshot.controls), None)
            if missing is not None:
                reason = f"control is missing: {missing}"
        if reason is not None:
            self._run = RpaRun(failure_reason=reason, state=RpaState.STOPPED, task_id=task.task_id)
            self._audit_log.append(
                RpaAuditEntry(
                    failure_reason=reason,
                    result="stopped",
                    screenshot_ref=snapshot.screenshot_ref,
                    step="safety_stop",
                )
            )
            self._persist()
            raise RpaSafetyError(reason)
        self._audit_log.append(RpaAuditEntry("ok", snapshot.screenshot_ref, "identify_window"))
        self._audit_log.append(RpaAuditEntry("ok", snapshot.screenshot_ref, "verify_patient"))
        for name in task.fields:
            self._audit_log.append(RpaAuditEntry("ok", snapshot.screenshot_ref, f"locate_control:{name}"))
        for name, value in task.fields.items():
            try:
                self._adapter.write_field(name, value)
                verification = self._adapter.refresh()
                if verification.window_id != task.expected_window_id:
                    raise RpaSafetyError("window changed after field write")
                if verification.patient_id != task.expected_patient_id:
                    raise RpaSafetyError("patient mismatch after field write")
                if verification.blocking_popup:
                    raise RpaSafetyError("blocking popup after field write")
                read_field = getattr(self._adapter, "read_field", None)
                actual = read_field(name) if callable(read_field) else None
                if (
                    actual is not None
                    and HermesCuaHisAdapter._normalise_value(actual)
                    != HermesCuaHisAdapter._normalise_value(value)
                ):
                    raise RpaSafetyError(f"field verification failed: {name}")
            except Exception as exc:
                reason = str(exc) if isinstance(exc, RpaSafetyError) else "field write failed"
                self._stop(task.task_id, reason, snapshot)
                raise RpaSafetyError(reason) from exc
            self._audit_log.append(RpaAuditEntry("ok", verification.screenshot_ref, f"fill_field:{name}"))
            self._audit_log.append(RpaAuditEntry("ok", verification.screenshot_ref, f"verify_field:{name}"))
        self._run = RpaRun(state=RpaState.AWAITING_CONFIRMATION, task_id=task.task_id)
        self._audit_log.append(RpaAuditEntry("ok", snapshot.screenshot_ref, "await_doctor_confirmation"))
        self._persist()
        return self._run

    @property
    def current_run(self) -> RpaRun | None:
        """Return the current task state, including any safety stop reason."""
        return self._run

    @property
    def audit_log(self) -> tuple[RpaAuditEntry, ...]:
        """Return the append-only audit entries for the current process."""
        return tuple(self._audit_log)

    def submit(self, task_id: str, confirmation: DoctorConfirmation | None = None) -> RpaRun:
        """Submit only a draft carrying a matching explicit doctor confirmation."""
        if confirmation is None:
            raise RpaSafetyError("doctor confirmation is required")
        task = self._task
        if task is None or self._run is None:
            raise RpaSafetyError("task is not prepared")
        if self._run.state == RpaState.SUBMITTED:
            raise RpaSafetyError("task is already submitted")
        if (
            task_id != task.task_id
            or confirmation.task_id != task.task_id
            or confirmation.patient_id != task.expected_patient_id
            or confirmation.window_id != task.expected_window_id
        ):
            raise RpaSafetyError("doctor confirmation does not match the prepared task")
        snapshot = self._adapter.refresh()
        reason: str | None = None
        if snapshot.window_id != task.expected_window_id:
            reason = "window changed before submit"
        elif snapshot.patient_id != task.expected_patient_id:
            reason = "patient mismatch before submit"
        elif snapshot.blocking_popup:
            reason = "blocking popup before submit"
        if reason is not None:
            self._run = RpaRun(failure_reason=reason, state=RpaState.STOPPED, task_id=task_id)
            self._audit_log.append(
                RpaAuditEntry(
                    failure_reason=reason,
                    result="stopped",
                    screenshot_ref=snapshot.screenshot_ref,
                    step="safety_stop",
                )
            )
            self._persist()
            raise RpaSafetyError(reason)
        try:
            self._adapter.submit()
        except Exception as exc:
            reason = "submit failed"
            self._stop(task_id, reason, snapshot)
            raise RpaSafetyError(reason) from exc
        self._run = RpaRun(state=RpaState.SUBMITTED, task_id=task_id)
        self._audit_log.append(RpaAuditEntry("ok", self._adapter.snapshot.screenshot_ref, "submit"))
        self._persist()
        return self._run

    def _stop(self, task_id: str, reason: str, snapshot: HisSnapshot) -> None:
        self._run = RpaRun(failure_reason=reason, state=RpaState.STOPPED, task_id=task_id)
        self._audit_log.append(
            RpaAuditEntry(
                failure_reason=reason,
                result="stopped",
                screenshot_ref=snapshot.screenshot_ref,
                step="safety_stop",
            )
        )
        self._persist()

    def _persist(self) -> None:
        if self._journal_path is None or self._run is None or self._task is None:
            return
        path = self._journal_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "audit_log": [
                {
                    "failure_reason": entry.failure_reason,
                    "result": entry.result,
                    "screenshot_ref": entry.screenshot_ref,
                    "step": entry.step,
                }
                for entry in self._audit_log
            ],
            "run": {
                "failure_reason": self._run.failure_reason,
                "state": self._run.state.value,
                "task_id": self._run.task_id,
            },
            "task": {
                "expected_patient_id": self._task.expected_patient_id,
                "expected_window_id": self._task.expected_window_id,
                "fields": dict(self._task.fields),
                "task_id": self._task.task_id,
            },
        }
        staged = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        staged.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        os.replace(staged, path)

    def _restore(self) -> None:
        if self._journal_path is None:
            return
        try:
            payload = json.loads(self._journal_path.read_text(encoding="utf-8"))
            task = payload["task"]
            run = payload["run"]
            audit_log = payload["audit_log"]
            self._task = RpaTask(
                expected_patient_id=str(task["expected_patient_id"]),
                expected_window_id=str(task["expected_window_id"]),
                fields={str(key): str(value) for key, value in task["fields"].items()},
                task_id=str(task["task_id"]),
            )
            self._run = RpaRun(
                failure_reason=run["failure_reason"],
                state=RpaState(run["state"]),
                task_id=str(run["task_id"]),
            )
            self._audit_log = [
                RpaAuditEntry(
                    failure_reason=entry["failure_reason"],
                    result=str(entry["result"]),
                    screenshot_ref=str(entry["screenshot_ref"]),
                    step=str(entry["step"]),
                )
                for entry in audit_log
            ]
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise RpaSafetyError("rpa journal is invalid") from exc


def load_cua_rpa_machine(config_path: Path, backend: CuaBackend) -> RpaStateMachine:
    """Build one patient-bound CUA state machine from an HIS mapping file.

    Args:
        config_path: JSON file containing app, patient, control, and journal mappings.
        backend: Started Hermes computer-use backend.

    Returns:
        Configured confirmation-gated RPA state machine.

    Raises:
        RpaSafetyError: If the deployment mapping is missing or malformed.
    """
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        controls_payload = payload["controls"]
        if not isinstance(controls_payload, dict) or not controls_payload:
            raise ValueError("controls must be a non-empty object")
        controls: dict[str, CuaControlLocator] = {}
        for name, value in controls_payload.items():
            if not isinstance(value, dict):
                raise ValueError("control mapping must be an object")
            coordinate = value.get("fallback_coordinate")
            fallback: tuple[int, int] | None = None
            if coordinate is not None:
                if (
                    not isinstance(coordinate, list)
                    or len(coordinate) != 2
                    or not all(isinstance(item, int) for item in coordinate)
                ):
                    raise ValueError("fallback_coordinate must contain two integers")
                fallback = (coordinate[0], coordinate[1])
            controls[str(name)] = CuaControlLocator(
                automation_id=str(value["automation_id"]),
                fallback_coordinate=fallback,
            )
        journal_path = Path(str(payload["journal_path"]))
        if not journal_path.is_absolute():
            journal_path = config_path.parent / journal_path
        adapter = HermesCuaHisAdapter(
            app=str(payload["app"]),
            backend=backend,
            controls=controls,
            patient_automation_id=str(payload["patient_automation_id"]),
        )
        return RpaStateMachine(adapter, journal_path=journal_path)
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RpaSafetyError("rpa config is invalid") from exc
