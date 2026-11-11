"""Latest-only screen context for CLINVEXA desktop monitoring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ScreenMonitorStatus = Literal["monitoring", "paused"]


@dataclass(frozen=True, slots=True)
class ScreenContext:
    """Describe one foreground-window observation."""

    captured_at: str
    process_name: str
    title: str
    window_id: str


class ScreenContextStore:
    """Keep the latest foreground-window context without a second database."""

    def __init__(self) -> None:
        self._latest: ScreenContext | None = None
        self._status: ScreenMonitorStatus = "monitoring"

    @property
    def status(self) -> ScreenMonitorStatus:
        """Return the current monitoring status."""
        return self._status

    def update(self, context: ScreenContext) -> bool:
        """Store a foreground-window context when monitoring is active.

        Args:
            context: Latest desktop foreground-window observation.

        Returns:
            True when the context was accepted, otherwise False while paused.

        Raises:
            ValueError: If the context has no window identity.
        """
        if not context.window_id.strip():
            raise ValueError("screen context window identity cannot be empty")
        if self._status == "paused":
            return False
        self._latest = context
        return True

    def latest(self) -> ScreenContext | None:
        """Return the latest accepted foreground-window context."""
        return self._latest

    def pause(self) -> None:
        """Pause acceptance of new foreground-window contexts."""
        self._status = "paused"

    def resume(self) -> None:
        """Resume acceptance of foreground-window contexts."""
        self._status = "monitoring"

    def clear(self) -> None:
        """Discard the latest foreground-window context."""
        self._latest = None
