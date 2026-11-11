from __future__ import annotations

import pytest

from clinvexa.rpa import (
    DoctorConfirmation,
    HisSnapshot,
    RpaSafetyError,
    RpaState,
    RpaStateMachine,
    RpaTask,
    SimulatedHisAdapter,
)


def test_two_hundred_simulated_his_flows_fill_and_submit_without_safety_violation() -> None:
    completed = 0
    unconfirmed_submits = 0
    wrong_patient_submits = 0
    duplicate_submits = 0

    for index in range(200):
        patient_id = f"SYN-P{index:03d}"
        task_id = f"task-{index:03d}"
        adapter = SimulatedHisAdapter(
            HisSnapshot(
                controls=frozenset({"chief_complaint", "assessment", "submit"}),
                patient_id=patient_id,
                screenshot_ref=f"screen://success/{index}",
                window_id="synthetic-his-main",
            )
        )
        machine = RpaStateMachine(adapter)
        task = RpaTask(
            expected_patient_id=patient_id,
            expected_window_id="synthetic-his-main",
            fields={"assessment": "合成评估", "chief_complaint": "合成主诉"},
            task_id=task_id,
        )
        assert machine.prepare(task).state == RpaState.AWAITING_CONFIRMATION

        with pytest.raises(RpaSafetyError, match="doctor confirmation is required"):
            machine.submit(task_id)
        unconfirmed_submits += adapter.submit_count

        with pytest.raises(RpaSafetyError, match="confirmation does not match"):
            machine.submit(
                task_id,
                DoctorConfirmation(
                    doctor_id="doctor-acceptance",
                    patient_id="SYN-WRONG",
                    task_id=task_id,
                    window_id="synthetic-his-main",
                ),
            )
        wrong_patient_submits += adapter.submit_count

        confirmation = DoctorConfirmation(
            doctor_id="doctor-acceptance",
            patient_id=patient_id,
            task_id=task_id,
            window_id="synthetic-his-main",
        )
        assert machine.submit(task_id, confirmation).state == RpaState.SUBMITTED
        completed += 1

        with pytest.raises(RpaSafetyError, match="task is already submitted"):
            machine.submit(task_id, confirmation)
        duplicate_submits += adapter.submit_count - 1

    assert completed == 200
    assert unconfirmed_submits == 0
    assert wrong_patient_submits == 0
    assert duplicate_submits == 0


def test_clinvexa_demo_fills_all_six_his_draft_fields_and_stops_before_formal_submit() -> None:
    fields = {
        "chief_complaint": "咳嗽3天，伴低热1天",
        "present_illness": "3天前出现干咳，偶有少量白痰；最高体温37.8℃；无胸痛、无明显气促。",
        "exam_summary": "体温37.6℃；心率86次/分；呼吸18次/分；血氧98%；白细胞10.8×10^9/L；CRP 18mg/L；流感抗原阴性。",
        "diagnosis": "急性上呼吸道感染（待医生确认）",
        "plan": "注意休息和补液；监测体温；症状加重及时复诊或就医。",
        "follow_up": "3天后门诊复诊；如症状加重则提前复诊。",
    }
    adapter = SimulatedHisAdapter(
        HisSnapshot(
            controls=frozenset({*fields, "submit"}),
            patient_id="DC-DEMO-0001",
            screenshot_ref="screen://clinvexa-demo",
            window_id="CLINVEXA 模拟 HIS",
        )
    )
    machine = RpaStateMachine(adapter)

    prepared = machine.prepare(
        RpaTask(
            expected_patient_id="DC-DEMO-0001",
            expected_window_id="CLINVEXA 模拟 HIS",
            fields=fields,
            task_id="clinvexa-demo-001",
        )
    )

    assert prepared.state == RpaState.AWAITING_CONFIRMATION
    assert adapter.values == fields
    assert adapter.submit_count == 0
    assert [entry.step for entry in machine.audit_log if entry.step.startswith("verify_field:")] == [
        f"verify_field:{name}" for name in fields
    ]


@pytest.mark.parametrize("anomaly", ["patient", "window", "popup", "control"])
def test_each_simulated_his_anomaly_stops_fifty_of_fifty_runs(anomaly: str) -> None:
    stopped = 0
    submitted = 0

    for index in range(50):
        patient_id = "SYN-WRONG" if anomaly == "patient" else "SYN-P001"
        window_id = "synthetic-his-other" if anomaly == "window" else "synthetic-his-main"
        controls = frozenset() if anomaly == "control" else frozenset({"chief_complaint", "submit"})
        adapter = SimulatedHisAdapter(
            HisSnapshot(
                blocking_popup=anomaly == "popup",
                controls=controls,
                patient_id=patient_id,
                screenshot_ref=f"screen://{anomaly}/{index}",
                window_id=window_id,
            )
        )
        machine = RpaStateMachine(adapter)

        with pytest.raises(RpaSafetyError):
            machine.prepare(
                RpaTask(
                    expected_patient_id="SYN-P001",
                    expected_window_id="synthetic-his-main",
                    fields={"chief_complaint": "不应写入"},
                    task_id=f"task-{anomaly}-{index}",
                )
            )

        stopped += int(machine.current_run is not None and machine.current_run.state == RpaState.STOPPED)
        submitted += adapter.submit_count

    assert stopped == 50
    assert submitted == 0
