from __future__ import annotations

from clinvexa.agents import (
    AGENTS,
    AgentResult,
    aggregate_agent_results,
    build_delegation_task,
    override_route,
    route_task,
)


def test_four_roles_are_fixed_and_delegate_through_hermes() -> None:
    assert tuple(AGENTS) == (
        "orchestrator",
        "medical_record",
        "knowledge_patient",
        "desktop_his",
    )
    task = build_delegation_task("medical_record", "结构化这份病历")
    assert task["role"] == "leaf"
    assert "结构化这份病历" in task["goal"]


def test_two_hundred_mixed_tasks_route_with_at_least_ninety_five_percent_accuracy() -> None:
    templates = {
        "orchestrator": ["你好", "查看今日任务", "帮我规划办公事项", "停止当前任务"],
        "medical_record": ["生成病历草稿", "病历结构化", "检查文书缺项", "转写问诊录音"],
        "knowledge_patient": ["生成患者摘要", "制定随访草稿", "检索医学指南", "整理检验趋势"],
        "desktop_his": ["分析当前屏幕", "打开HIS患者页面", "RPA填写表单", "定位桌面窗口"],
    }
    cases = [
        (expected, f"{template}，合成任务编号 {index:03d}")
        for expected, group in templates.items()
        for index in range(50)
        for template in [group[index % len(group)]]
    ]

    correct = sum(route_task(text).agent_id == expected for expected, text in cases)

    assert len(cases) == 200
    assert correct / len(cases) >= 0.95


def test_user_can_override_a_route_and_failed_agent_remains_retryable() -> None:
    decision = route_task("生成患者摘要")
    overridden = override_route(decision, "medical_record")
    assert overridden.agent_id == "medical_record"
    assert overridden.user_overridden is True

    summary = aggregate_agent_results(
        [
            AgentResult(agent_id="medical_record", output="病历草稿", status="completed"),
            AgentResult(agent_id="knowledge_patient", error="knowledge source unavailable", status="failed"),
        ]
    )
    assert summary.completed_outputs == ("病历草稿",)
    assert summary.failed_agents == ("knowledge_patient",)
    assert summary.retryable is True

