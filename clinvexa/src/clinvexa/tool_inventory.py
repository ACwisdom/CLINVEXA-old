"""Runtime tool capability inventory for CLINVEXA."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import TypeAlias


UNAVAILABLE_TOOL_MESSAGE = "当前环境无该工具可调用"
ToolResult: TypeAlias = str | dict[str, object]
ToolDispatcher: TypeAlias = Callable[[str, dict[str, object]], ToolResult]


@dataclass(frozen=True, slots=True)
class ToolInventory:
    """Immutable snapshot of tools resolved for one Hermes Agent session."""

    names: tuple[str, ...]

    @classmethod
    def from_definitions(
        cls,
        definitions: Iterable[Mapping[str, object]],
    ) -> ToolInventory:
        """Build an inventory from OpenAI-format Hermes tool definitions.

        Args:
            definitions: Tool schemas from the session Agent's resolved
                ``agent.tools`` snapshot.

        Returns:
            A sorted, deduplicated inventory of valid tool names.
        """
        names: set[str] = set()
        for definition in definitions:
            function = definition.get("function")
            if not isinstance(function, Mapping):
                continue
            name = function.get("name")
            if isinstance(name, str) and name.strip():
                names.add(name.strip())
        return cls(names=tuple(sorted(names)))

    def contains(self, name: str) -> bool:
        """Return whether the session can call a named tool.

        Args:
            name: Exact Hermes tool name.

        Returns:
            ``True`` when the name exists in this session snapshot.
        """
        return name in self.names

    def dispatch(
        self,
        name: str,
        arguments: dict[str, object],
        dispatcher: ToolDispatcher,
    ) -> ToolResult:
        """Dispatch an available tool or return the product-level message.

        Args:
            name: Exact Hermes tool name requested by the caller.
            arguments: Tool arguments passed unchanged to Hermes.
            dispatcher: Hermes-compatible callable that executes the tool.

        Returns:
            The Hermes tool result, or the stable unavailable-tool message.
        """
        if not self.contains(name):
            return UNAVAILABLE_TOOL_MESSAGE
        return dispatcher(name, arguments)
