from __future__ import annotations

import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from tools.delegate_tool import delegate_task


def _parent_agent() -> MagicMock:
    parent = MagicMock()
    parent.base_url = "https://example.invalid/v1"
    parent.api_key = "stage-zero"
    parent.provider = "custom"
    parent.api_mode = "chat_completions"
    parent.model = "controlled-model"
    parent.platform = "cli"
    parent.providers_allowed = None
    parent.providers_ignored = None
    parent.providers_order = None
    parent.provider_sort = None
    parent._session_db = None
    parent._delegate_depth = 0
    parent._active_children = []
    parent._active_children_lock = threading.Lock()
    parent._print_fn = None
    parent._delegate_spinner = None
    parent.tool_progress_callback = None
    parent.thinking_callback = None
    parent._interrupt_requested = False
    return parent


def test_three_child_delegation_completes_one_hundred_consecutive_runs() -> None:
    def build_child(**kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(
            _delegate_role="leaf",
            task_index=kwargs["task_index"],
            tool_progress_callback=None,
        )

    def run_child(
        task_index: int,
        goal: str,
        child: SimpleNamespace,
        parent_agent: MagicMock,
    ) -> dict[str, object]:
        assert child.task_index == task_index
        assert parent_agent is parent
        return {
            "task_index": task_index,
            "status": "completed",
            "summary": goal,
            "error": None,
            "api_calls": 1,
            "duration_seconds": 0.0,
            "_child_role": "leaf",
        }

    parent = _parent_agent()
    credentials = {
        "provider": None,
        "base_url": None,
        "api_key": None,
        "api_mode": None,
        "model": None,
        "request_overrides": None,
        "max_output_tokens": None,
        "command": None,
        "args": None,
    }

    with (
        patch(
            "tools.delegate_tool._build_child_preserving_parent_tools",
            side_effect=build_child,
        ),
        patch("tools.delegate_tool._run_single_child", side_effect=run_child),
        patch("tools.delegate_tool._resolve_delegation_credentials", return_value=credentials),
        patch("tools.delegate_tool._get_max_concurrent_children", return_value=3),
        patch("tools.delegate_tool._get_max_spawn_depth", return_value=2),
        patch("tools.delegate_tool._finalize_child_results"),
        patch(
            "tools.delegation_live_log.create_live_transcripts",
            return_value=("controlled", [], []),
        ),
        patch("tools.delegation_live_log.update_manifest_statuses"),
    ):
        for run_index in range(100):
            goals = [f"run-{run_index}-agent-{agent_index}" for agent_index in range(3)]
            payload = json.loads(
                delegate_task(
                    tasks=[{"goal": goal} for goal in goals],
                    parent_agent=parent,
                )
            )

            assert [result["task_index"] for result in payload["results"]] == [0, 1, 2]
            assert [result["summary"] for result in payload["results"]] == goals
            assert all(result["status"] == "completed" for result in payload["results"])
