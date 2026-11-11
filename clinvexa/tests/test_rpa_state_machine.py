from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest

from tools.computer_use.backend import ActionResult, CaptureResult, UIElement


class ControlledCuaBackend:
    def __init__(self, capture: CaptureResult) -> None:
        self.capture_result = capture
        self.coordinate_clicks: list[tuple[int, int]] = []
        self.element_clicks: list[int] = []
        self.typed_text: list[str] = []
        self.values: dict[int, str] = {}

    def capture(self, **_kwargs) -> CaptureResult:
        return self.capture_result

    def set_value(self, value: str, element: int | None = None) -> ActionResult:
        assert element is not None
        self.values[element] = value
        return ActionResult(action="set_value", ok=True, verified=True)

    def click(
        self,
        *,
        element: int | None = None,
        x: int | None = None,
        y: int | None = None,
        **_kwargs,
    ) -> ActionResult:
        if element is not None:
            self.element_clicks.append(element)
        else:
            assert x is not None and y is not None
            self.coordinate_clicks.append((x, y))
        return ActionResult(action="click", ok=True, verified=True)

    def type_text(self, text: str, **_kwargs) -> ActionResult:
        self.typed_text.append(text)
        return ActionResult(action="type_text", ok=True, verified=True)


class AdversarialCuaBackend:
    """Exercise stale snapshots and Chromium ValuePattern failures."""

    def __init__(self, *, native_succeeds_after: int | None) -> None:
        self.native_succeeds_after = native_succeeds_after
        self.set_calls = 0
        self.capture_calls = 0
        self.value = "旧内容"
        self.clicked = 0
        self.key_calls: list[str] = []

    def capture(self, **_kwargs) -> CaptureResult:
        self.capture_calls += 1
        return CaptureResult(
            app="Chrome",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "chief_complaint", "value": self.value},
                    element_token=f"sdeadbeef:2",
                    index=2,
                    label="主诉",
                    role="Edit",
                ),
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            snapshot_id="sdeadbeef",
            width=1280,
            window_title="his-main",
        )

    def set_value(self, value: str, element: int | None = None) -> ActionResult:
        assert element == 2
        self.set_calls += 1
        if self.native_succeeds_after is not None and self.set_calls >= self.native_succeeds_after:
            self.value = value
            return ActionResult(action="set_value", ok=True, verified=True)
        return ActionResult(
            action="set_value",
            code="snapshot_id_required" if self.set_calls == 1 else "value_pattern_unavailable",
            effect="suspected_noop",
            ok=False,
            verified=False,
        )

    def click(self, *, element=None, **_kwargs) -> ActionResult:
        assert element == 2
        self.clicked += 1
        return ActionResult(action="click", ok=True, verified=True)

    def key(self, keys: str, **_kwargs) -> ActionResult:
        self.key_calls.append(keys)
        if keys == "ctrl+a":
            self.value = ""
        return ActionResult(action="key", ok=True, verified=True)

    def type_text(self, text: str, **_kwargs) -> ActionResult:
        self.value = text
        return ActionResult(action="type_text", ok=True, verified=True)


class FailingHisAdapter:
    def __init__(self, *, fail_on: str) -> None:
        self.fail_on = fail_on
        self.snapshot = _safe_snapshot("screen://failure")

    def refresh(self):
        return self.snapshot

    def write_field(self, name: str, value: str) -> None:
        if self.fail_on == "write":
            raise RuntimeError("synthetic write failure")

    def read_field(self, name: str) -> str | None:
        return None

    def submit(self) -> None:
        if self.fail_on == "submit":
            raise RuntimeError("synthetic submit failure")


def _safe_snapshot(screenshot_ref: str):
    rpa = _rpa_module()
    return rpa.HisSnapshot(
        controls=frozenset({"chief_complaint", "submit"}),
        patient_id="SYN-P001",
        screenshot_ref=screenshot_ref,
        window_id="his-main",
    )


def _rpa_module():
    try:
        return importlib.import_module("clinvexa.rpa")
    except ModuleNotFoundError:
        pytest.fail("CLINVEXA HIS RPA state machine is not implemented")


def test_draft_never_submits_without_doctor_confirmation() -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://initial",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    task = rpa.RpaTask(
        expected_patient_id="SYN-P001",
        expected_window_id="his-main",
        fields={"chief_complaint": "合成测试主诉"},
        task_id="task-001",
    )

    prepared = machine.prepare(task)

    assert prepared.state == rpa.RpaState.AWAITING_CONFIRMATION
    with pytest.raises(rpa.RpaSafetyError, match="doctor confirmation is required"):
        machine.submit(task.task_id)
    assert adapter.submit_count == 0


def test_matching_doctor_confirmation_submits_exactly_once() -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://confirm",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    task = rpa.RpaTask(
        expected_patient_id="SYN-P001",
        expected_window_id="his-main",
        fields={"chief_complaint": "合成测试主诉"},
        task_id="task-001",
    )
    machine.prepare(task)

    submitted = machine.submit(
        task.task_id,
        rpa.DoctorConfirmation(
            doctor_id="doctor-001",
            patient_id="SYN-P001",
            task_id="task-001",
            window_id="his-main",
        ),
    )

    assert submitted.state == rpa.RpaState.SUBMITTED
    assert adapter.submit_count == 1


def test_empty_patient_context_is_opened_before_draft_fields_are_written() -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "open_patient", "patient_search", "submit"}),
            patient_id="",
            screenshot_ref="screen://patient-search",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)

    prepared = machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-open-patient",
        )
    )

    assert prepared.state == rpa.RpaState.AWAITING_CONFIRMATION
    assert adapter.opened_patients == ["SYN-P001"]
    assert adapter.snapshot.patient_id == "SYN-P001"
    assert any(entry.step == "open_patient" for entry in machine.audit_log)


@pytest.mark.parametrize(
    ("window_id", "patient_id", "blocking_popup", "controls", "expected_reason"),
    [
        ("his-main", "SYN-OTHER", False, frozenset({"chief_complaint"}), "patient mismatch"),
        ("his-other", "SYN-P001", False, frozenset({"chief_complaint"}), "window changed"),
        ("his-main", "SYN-P001", True, frozenset({"chief_complaint"}), "blocking popup"),
        ("his-main", "SYN-P001", False, frozenset(), "control is missing: chief_complaint"),
    ],
)
def test_unsafe_his_snapshot_stops_before_any_write(
    window_id: str,
    patient_id: str,
    blocking_popup: bool,
    controls: frozenset[str],
    expected_reason: str,
) -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            blocking_popup=blocking_popup,
            controls=controls,
            patient_id=patient_id,
            screenshot_ref="screen://unsafe",
            window_id=window_id,
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    task = rpa.RpaTask(
        expected_patient_id="SYN-P001",
        expected_window_id="his-main",
        fields={"chief_complaint": "不应写入"},
        task_id="task-unsafe",
    )

    with pytest.raises(rpa.RpaSafetyError, match=expected_reason):
        machine.prepare(task)

    assert machine.current_run == rpa.RpaRun(
        failure_reason=expected_reason,
        state=rpa.RpaState.STOPPED,
        task_id="task-unsafe",
    )
    assert adapter.values == {}
    assert adapter.submit_count == 0
    assert machine.audit_log[-1] == rpa.RpaAuditEntry(
        failure_reason=expected_reason,
        result="stopped",
        screenshot_ref="screen://unsafe",
        step="safety_stop",
    )


@pytest.mark.parametrize(
    ("submitted_task_id", "confirmed_task_id", "confirmed_patient_id", "confirmed_window_id"),
    [
        ("task-other", "task-001", "SYN-P001", "his-main"),
        ("task-001", "task-other", "SYN-P001", "his-main"),
        ("task-001", "task-001", "SYN-OTHER", "his-main"),
        ("task-001", "task-001", "SYN-P001", "his-other"),
    ],
)
def test_mismatched_confirmation_never_submits(
    submitted_task_id: str,
    confirmed_task_id: str,
    confirmed_patient_id: str,
    confirmed_window_id: str,
) -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://confirmation-mismatch",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-001",
        )
    )

    with pytest.raises(rpa.RpaSafetyError, match="confirmation does not match"):
        machine.submit(
            submitted_task_id,
            rpa.DoctorConfirmation(
                doctor_id="doctor-001",
                patient_id=confirmed_patient_id,
                task_id=confirmed_task_id,
                window_id=confirmed_window_id,
            ),
        )

    assert adapter.submit_count == 0


def test_repeated_confirmation_cannot_submit_twice() -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://duplicate",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-001",
        )
    )
    confirmation = rpa.DoctorConfirmation(
        doctor_id="doctor-001",
        patient_id="SYN-P001",
        task_id="task-001",
        window_id="his-main",
    )
    machine.submit("task-001", confirmation)

    with pytest.raises(rpa.RpaSafetyError, match="task is already submitted"):
        machine.submit("task-001", confirmation)

    assert adapter.submit_count == 1


def test_successful_flow_audits_every_rpa_step_with_screenshot_reference() -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://audit-success",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-audit",
        )
    )
    machine.submit(
        "task-audit",
        rpa.DoctorConfirmation(
            doctor_id="doctor-001",
            patient_id="SYN-P001",
            task_id="task-audit",
            window_id="his-main",
        ),
    )

    assert [(entry.step, entry.result, entry.screenshot_ref) for entry in machine.audit_log] == [
        ("identify_window", "ok", "screen://audit-success"),
        ("verify_patient", "ok", "screen://audit-success"),
        ("locate_control:chief_complaint", "ok", "screen://audit-success"),
        ("fill_field:chief_complaint", "ok", "screen://audit-success"),
        ("verify_field:chief_complaint", "ok", "screen://audit-success"),
        ("await_doctor_confirmation", "ok", "screen://audit-success"),
        ("submit", "ok", "screen://audit-success"),
    ]


def test_pending_task_and_audit_recover_after_service_restart(tmp_path: Path) -> None:
    rpa = _rpa_module()
    journal_path = tmp_path / "rpa-state.json"
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://restart",
            window_id="his-main",
        )
    )
    first_process = rpa.RpaStateMachine(adapter, journal_path=journal_path)
    first_process.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-restart",
        )
    )

    restarted = rpa.RpaStateMachine(adapter, journal_path=journal_path)

    assert restarted.current_run == rpa.RpaRun(
        state=rpa.RpaState.AWAITING_CONFIRMATION,
        task_id="task-restart",
    )
    assert [entry.step for entry in restarted.audit_log] == [
        "identify_window",
        "verify_patient",
        "locate_control:chief_complaint",
        "fill_field:chief_complaint",
        "verify_field:chief_complaint",
        "await_doctor_confirmation",
    ]
    restarted.submit(
        "task-restart",
        rpa.DoctorConfirmation(
            doctor_id="doctor-001",
            patient_id="SYN-P001",
            task_id="task-restart",
            window_id="his-main",
        ),
    )
    assert adapter.submit_count == 1


def test_cua_adapter_prefers_uia_control_over_coordinate_fallback() -> None:
    rpa = _rpa_module()
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "chief_complaint"},
                    index=2,
                    label="主诉",
                    role="Edit",
                ),
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            width=1280,
            window_title="his-main",
        )
    )
    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={
            "chief_complaint": rpa.CuaControlLocator(
                automation_id="chief_complaint",
                fallback_coordinate=(300, 240),
            )
        },
        patient_automation_id="patient_id",
    )

    adapter.write_field("chief_complaint", "合成测试主诉")

    assert adapter.snapshot.patient_id == "SYN-P001"
    assert adapter.snapshot.window_id == "his-main"
    assert backend.values == {2: "合成测试主诉"}
    assert backend.coordinate_clicks == []


def test_cua_adapter_recaptures_after_stale_snapshot_without_user_intervention() -> None:
    rpa = _rpa_module()
    backend = AdversarialCuaBackend(native_succeeds_after=2)
    adapter = rpa.HermesCuaHisAdapter(
        app="Chrome",
        backend=backend,
        controls={"chief_complaint": rpa.CuaControlLocator("chief_complaint")},
        patient_automation_id="patient_id",
    )

    adapter.write_field("chief_complaint", "腹痛3天，餐后加重")

    assert backend.value == "腹痛3天，餐后加重"
    assert backend.set_calls == 2
    assert backend.clicked == 0
    assert backend.capture_calls >= 3


def test_cua_adapter_falls_back_to_focus_select_all_type_and_readback() -> None:
    rpa = _rpa_module()
    backend = AdversarialCuaBackend(native_succeeds_after=None)
    adapter = rpa.HermesCuaHisAdapter(
        app="Chrome",
        backend=backend,
        controls={"chief_complaint": rpa.CuaControlLocator("chief_complaint")},
        patient_automation_id="patient_id",
    )

    adapter.write_field("chief_complaint", "咳嗽3天\r\n伴发热1天")

    assert backend.value == "咳嗽3天\r\n伴发热1天"
    assert backend.set_calls == 2
    assert backend.clicked == 1
    assert backend.key_calls == ["ctrl+a"]


def test_cua_adapter_uses_configured_coordinate_only_with_screenshot_evidence() -> None:
    rpa = _rpa_module()
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                )
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            width=1280,
            window_title="his-main",
        )
    )
    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={
            "chief_complaint": rpa.CuaControlLocator(
                automation_id="chief_complaint",
                fallback_coordinate=(300, 240),
            )
        },
        patient_automation_id="patient_id",
    )

    adapter.write_field("chief_complaint", "合成坐标回退主诉")

    assert "chief_complaint" in adapter.snapshot.controls
    assert backend.values == {}
    assert backend.coordinate_clicks == [(300, 240)]
    assert backend.typed_text == ["合成坐标回退主诉"]


def test_cua_adapter_submits_through_configured_uia_button() -> None:
    rpa = _rpa_module()
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "submit_record"},
                    index=3,
                    label="提交",
                    role="Button",
                ),
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            width=1280,
            window_title="his-main",
        )
    )
    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={"submit": rpa.CuaControlLocator(automation_id="submit_record")},
        patient_automation_id="patient_id",
    )

    adapter.submit()

    assert backend.element_clicks == [3]
    assert backend.coordinate_clicks == []


def test_cua_adapter_opens_patient_through_configured_uia_controls() -> None:
    rpa = _rpa_module()
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": ""},
                    index=1,
                    label="",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "patient_search"},
                    index=2,
                    label="患者编号",
                    role="Edit",
                ),
                UIElement(
                    attributes={"automation_id": "open_patient"},
                    index=3,
                    label="打开患者",
                    role="Button",
                ),
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            width=1280,
            window_title="his-main",
        )
    )
    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={
            "open_patient": rpa.CuaControlLocator(automation_id="open_patient"),
            "patient_search": rpa.CuaControlLocator(automation_id="patient_search"),
        },
        patient_automation_id="patient_id",
    )

    adapter.open_patient("SYN-P001")

    assert backend.values == {2: "SYN-P001"}
    assert backend.element_clicks == [3]


def test_cua_adapter_marks_native_dialog_as_blocking_popup() -> None:
    rpa = _rpa_module()
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "warning_dialog", "modal": True},
                    index=4,
                    label="患者信息确认",
                    role="Dialog",
                ),
            ],
            height=720,
            mode="som",
            png_b64="c3ludGhldGlj",
            width=1280,
            window_title="his-main",
        )
    )

    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={},
        patient_automation_id="patient_id",
    )

    assert adapter.snapshot.blocking_popup is True


@pytest.mark.parametrize(("fail_on", "expected_reason"), [("write", "field write failed"), ("submit", "submit failed")])
def test_action_failure_stops_task_and_is_audited(fail_on: str, expected_reason: str) -> None:
    rpa = _rpa_module()
    adapter = FailingHisAdapter(fail_on=fail_on)
    machine = rpa.RpaStateMachine(adapter)
    task = rpa.RpaTask(
        expected_patient_id="SYN-P001",
        expected_window_id="his-main",
        fields={"chief_complaint": "合成测试主诉"},
        task_id=f"task-{fail_on}-failure",
    )

    if fail_on == "write":
        operation = lambda: machine.prepare(task)
    else:
        machine.prepare(task)
        operation = lambda: machine.submit(
            task.task_id,
            rpa.DoctorConfirmation(
                doctor_id="doctor-001",
                patient_id="SYN-P001",
                task_id=task.task_id,
                window_id="his-main",
            ),
        )

    with pytest.raises(rpa.RpaSafetyError, match=expected_reason):
        operation()

    assert machine.current_run == rpa.RpaRun(
        failure_reason=expected_reason,
        state=rpa.RpaState.STOPPED,
        task_id=task.task_id,
    )
    assert machine.audit_log[-1] == rpa.RpaAuditEntry(
        failure_reason=expected_reason,
        result="stopped",
        screenshot_ref=adapter.snapshot.screenshot_ref,
        step="safety_stop",
    )


@pytest.mark.parametrize(
    ("window_id", "patient_id", "blocking_popup", "expected_reason"),
    [
        ("his-other", "SYN-P001", False, "window changed before submit"),
        ("his-main", "SYN-OTHER", False, "patient mismatch before submit"),
        ("his-main", "SYN-P001", True, "blocking popup before submit"),
    ],
)
def test_his_context_is_rechecked_immediately_before_submit(
    window_id: str,
    patient_id: str,
    blocking_popup: bool,
    expected_reason: str,
) -> None:
    rpa = _rpa_module()
    adapter = rpa.SimulatedHisAdapter(
        rpa.HisSnapshot(
            controls=frozenset({"chief_complaint", "submit"}),
            patient_id="SYN-P001",
            screenshot_ref="screen://before-draft",
            window_id="his-main",
        )
    )
    machine = rpa.RpaStateMachine(adapter)
    machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-context-change",
        )
    )
    adapter.snapshot = rpa.HisSnapshot(
        blocking_popup=blocking_popup,
        controls=frozenset({"chief_complaint", "submit"}),
        patient_id=patient_id,
        screenshot_ref="screen://before-submit",
        window_id=window_id,
    )

    with pytest.raises(rpa.RpaSafetyError, match=expected_reason):
        machine.submit(
            "task-context-change",
            rpa.DoctorConfirmation(
                doctor_id="doctor-001",
                patient_id="SYN-P001",
                task_id="task-context-change",
                window_id="his-main",
            ),
        )

    assert adapter.submit_count == 0
    assert machine.current_run == rpa.RpaRun(
        failure_reason=expected_reason,
        state=rpa.RpaState.STOPPED,
        task_id="task-context-change",
    )


def test_cua_adapter_recaptures_window_immediately_before_submit() -> None:
    rpa = _rpa_module()
    elements = [
        UIElement(
            attributes={"automation_id": "patient_id", "value": "SYN-P001"},
            index=1,
            label="SYN-P001",
            role="Text",
        ),
        UIElement(
            attributes={"automation_id": "chief_complaint"},
            index=2,
            label="主诉",
            role="Edit",
        ),
        UIElement(
            attributes={"automation_id": "submit_record"},
            index=3,
            label="提交",
            role="Button",
        ),
    ]
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=elements,
            height=720,
            mode="som",
            png_b64="YmVmb3Jl",
            width=1280,
            window_title="his-main",
        )
    )
    adapter = rpa.HermesCuaHisAdapter(
        app="Synthetic HIS",
        backend=backend,
        controls={
            "chief_complaint": rpa.CuaControlLocator(automation_id="chief_complaint"),
            "submit": rpa.CuaControlLocator(automation_id="submit_record"),
        },
        patient_automation_id="patient_id",
    )
    machine = rpa.RpaStateMachine(adapter)
    machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成测试主诉"},
            task_id="task-live-capture",
        )
    )
    backend.capture_result = CaptureResult(
        app="Synthetic HIS",
        elements=elements,
        height=720,
        mode="som",
        png_b64="YWZ0ZXI=",
        width=1280,
        window_title="his-other",
    )

    with pytest.raises(rpa.RpaSafetyError, match="window changed before submit"):
        machine.submit(
            "task-live-capture",
            rpa.DoctorConfirmation(
                doctor_id="doctor-001",
                patient_id="SYN-P001",
                task_id="task-live-capture",
                window_id="his-main",
            ),
        )

    assert backend.element_clicks == []


def test_cua_rpa_machine_loads_his_control_mapping_from_deployment_config(tmp_path: Path) -> None:
    rpa = _rpa_module()
    config_path = tmp_path / "his-rpa.json"
    config_path.write_text(
        json.dumps(
            {
                "app": "Synthetic HIS",
                "controls": {
                    "chief_complaint": {"automation_id": "chief_complaint"},
                    "submit": {"automation_id": "submit_record"},
                },
                "journal_path": "rpa-state.json",
                "patient_automation_id": "patient_id",
            }
        ),
        encoding="utf-8",
    )
    backend = ControlledCuaBackend(
        CaptureResult(
            app="Synthetic HIS",
            elements=[
                UIElement(
                    attributes={"automation_id": "patient_id", "value": "SYN-P001"},
                    index=1,
                    label="SYN-P001",
                    role="Text",
                ),
                UIElement(
                    attributes={"automation_id": "chief_complaint"},
                    index=2,
                    label="主诉",
                    role="Edit",
                ),
                UIElement(
                    attributes={"automation_id": "submit_record"},
                    index=3,
                    label="提交",
                    role="Button",
                ),
            ],
            height=720,
            mode="som",
            png_b64="Y29uZmln",
            width=1280,
            window_title="his-main",
        )
    )
    machine = rpa.load_cua_rpa_machine(config_path, backend)

    run = machine.prepare(
        rpa.RpaTask(
            expected_patient_id="SYN-P001",
            expected_window_id="his-main",
            fields={"chief_complaint": "合成配置主诉"},
            task_id="task-config",
        )
    )

    assert run.state == rpa.RpaState.AWAITING_CONFIRMATION
    assert backend.values == {2: "合成配置主诉"}
    assert tmp_path.joinpath("rpa-state.json").is_file()
