from __future__ import annotations

from collections.abc import Callable

import pytest

from clinvexa.tool_inventory import (
    UNAVAILABLE_TOOL_MESSAGE,
    ToolInventory,
)
from tools.registry import ToolRegistry


def tool_definition(name: str, description: str = "") -> dict[str, object]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def test_inventory_uses_resolved_agent_tool_definitions() -> None:
    inventory = ToolInventory.from_definitions(
        [
            tool_definition("terminal", "run a command"),
            tool_definition("memory", "store memory"),
            tool_definition("terminal", "duplicate"),
            {"type": "function", "function": {"description": "missing name"}},
        ]
    )

    assert inventory.names == ("memory", "terminal")
    assert inventory.contains("terminal") is True
    assert inventory.contains("browser_navigate") is False


def test_available_tool_is_dispatched_once() -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def dispatch(name: str, arguments: dict[str, object]) -> str:
        calls.append((name, arguments))
        return '{"ok": true}'

    inventory = ToolInventory.from_definitions([tool_definition("terminal")])

    result = inventory.dispatch("terminal", {"command": "whoami"}, dispatch)

    assert result == '{"ok": true}'
    assert calls == [("terminal", {"command": "whoami"})]


MISSING_TOOL_NAMES = tuple(f"missing_tool_{index:02d}" for index in range(20))


@pytest.mark.parametrize("tool_name", MISSING_TOOL_NAMES)
def test_missing_tool_returns_clear_message_without_dispatch(tool_name: str) -> None:
    dispatched: list[str] = []

    def dispatch(name: str, arguments: dict[str, object]) -> str:
        dispatched.append(name)
        return "fabricated result"

    inventory = ToolInventory.from_definitions([tool_definition("terminal")])

    result = inventory.dispatch(tool_name, {}, dispatch)

    assert result == UNAVAILABLE_TOOL_MESSAGE
    assert result == "当前环境无该工具可调用"
    assert dispatched == []


def test_dispatch_accepts_registry_compatible_callable() -> None:
    dispatcher: Callable[[str, dict[str, object]], str] = lambda name, args: name
    inventory = ToolInventory.from_definitions([tool_definition("memory")])

    assert inventory.dispatch("memory", {}, dispatcher) == "memory"


def test_inventory_dispatches_every_tool_exposed_by_hermes_registry() -> None:
    registry = ToolRegistry()
    expected_names = {f"controlled_tool_{index}" for index in range(5)}

    for name in expected_names:
        registry.register(
            name=name,
            toolset="clinvexa-stage-zero",
            schema={
                "name": name,
                "description": "controlled Stage 0 test tool",
                "parameters": {"type": "object", "properties": {}},
            },
            handler=lambda arguments, **kwargs: str(arguments["value"]),
        )

    registry.register(
        name="unavailable_controlled_tool",
        toolset="clinvexa-stage-zero",
        schema={
            "name": "unavailable_controlled_tool",
            "description": "unavailable Stage 0 test tool",
            "parameters": {"type": "object", "properties": {}},
        },
        handler=lambda arguments, **kwargs: "must not run",
        check_fn=lambda: False,
    )

    definitions = registry.get_definitions(
        expected_names | {"unavailable_controlled_tool"},
        quiet=True,
    )
    inventory = ToolInventory.from_definitions(definitions)

    assert set(inventory.names) == expected_names
    for name in expected_names:
        result = inventory.dispatch(
            name,
            {"value": name},
            lambda tool_name, arguments: registry.dispatch(
                tool_name,
                arguments,
            ),
        )
        assert result == name

    assert (
        inventory.dispatch(
            "unavailable_controlled_tool",
            {},
            lambda tool_name, arguments: registry.dispatch(tool_name, arguments),
        )
        == UNAVAILABLE_TOOL_MESSAGE
    )
