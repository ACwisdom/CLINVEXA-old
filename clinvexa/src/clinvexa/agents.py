"""CLINVEXA role definitions and deterministic routing around Hermes delegation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AgentId = Literal["orchestrator", "medical_record", "knowledge_patient", "desktop_his"]
AgentStatus = Literal["completed", "failed"]


@dataclass(frozen=True, slots=True)
class AgentConfig:
    """Describe one fixed CLINVEXA Agent role."""

    agent_id: AgentId
    mission: str


@dataclass(frozen=True, slots=True)
class RouteDecision:
    """Represent the selected Agent and whether the user changed it."""

    agent_id: AgentId
    reason: str
    user_overridden: bool = False


@dataclass(frozen=True, slots=True)
class AgentResult:
    """Represent one specialist Agent result returned by Hermes."""

    agent_id: AgentId
    status: AgentStatus
    output: str = ""
    error: str = ""


@dataclass(frozen=True, slots=True)
class AggregatedAgentResult:
    """Summarize successful and failed specialist results."""

    completed_outputs: tuple[str, ...]
    failed_agents: tuple[AgentId, ...]
    retryable: bool


AGENTS: dict[AgentId, AgentConfig] = {
    "orchestrator": AgentConfig("orchestrator", "判断意图、委派任务并汇总结果"),
    "medical_record": AgentConfig("medical_record", "转写、事实抽取、病历草稿和文书质控"),
    "knowledge_patient": AgentConfig("knowledge_patient", "患者摘要、知识检索和随访草稿"),
    "desktop_his": AgentConfig("desktop_his", "屏幕理解、桌面工具和 HIS RPA"),
}

_ROUTE_KEYWORDS: tuple[tuple[AgentId, tuple[str, ...]], ...] = (
    (
        "desktop_his",
        ("当前屏幕", "截图", "桌面", "窗口", "his", "rpa", "点击", "填写表单", "患者页面"),
    ),
    (
        "medical_record",
        (
            "病历",
            "文书",
            "主诉",
            "现病史",
            "质控",
            "缺项",
            "问诊录音",
            "转写",
            "出院小结",
            "门诊摘要",
        ),
    ),
    (
        "knowledge_patient",
        ("患者摘要", "随访", "医学", "指南", "知识", "检验趋势", "科研", "文献"),
    ),
)


def route_task(text: str) -> RouteDecision:
    """Select the fixed CLINVEXA role for a task.

    Args:
        text: User task text.

    Returns:
        Deterministic route decision suitable for user override.
    """
    normalized = text.strip().casefold()
    for agent_id, keywords in _ROUTE_KEYWORDS:
        matched = next((keyword for keyword in keywords if keyword in normalized), None)
        if matched:
            return RouteDecision(agent_id=agent_id, reason=f"matched keyword: {matched}")
    return RouteDecision(agent_id="orchestrator", reason="no specialist keyword matched")


def override_route(decision: RouteDecision, agent_id: AgentId) -> RouteDecision:
    """Apply an explicit user-selected Agent route.

    Args:
        decision: Existing automatic decision.
        agent_id: User-selected fixed role.

    Returns:
        A decision marked as user overridden.
    """
    return RouteDecision(
        agent_id=agent_id,
        reason=f"user override from {decision.agent_id}",
        user_overridden=True,
    )


def build_delegation_task(agent_id: AgentId, task: str) -> dict[str, str]:
    """Build one task for Hermes's native ``delegate_task`` tool.

    Args:
        agent_id: Specialist role that should handle the task.
        task: User task text.

    Returns:
        Hermes-compatible leaf task payload.
    """
    config = AGENTS[agent_id]
    return {
        "goal": f"你是 CLINVEXA {agent_id} Agent。职责：{config.mission}。任务：{task}",
        "context": "只依据输入和实际工具结果；医疗输出必须由医生复核。",
        "role": "leaf",
    }


def aggregate_agent_results(results: list[AgentResult]) -> AggregatedAgentResult:
    """Aggregate Hermes child results without hiding specialist failures.

    Args:
        results: Completed or failed specialist outputs.

    Returns:
        Visible successful outputs, failed roles, and retry capability.
    """
    completed = tuple(result.output for result in results if result.status == "completed" and result.output)
    failed = tuple(result.agent_id for result in results if result.status == "failed")
    return AggregatedAgentResult(
        completed_outputs=completed,
        failed_agents=failed,
        retryable=bool(failed),
    )
