"""CLINVEXA records stored through the Hermes Memory store."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from tools.memory_tool import MemoryStore

_ENTRY_PREFIX = "CLINVEXA_RECORD:"


@dataclass(frozen=True, slots=True)
class CLINVEXAMemoryRecord:
    """A patient, preference, or task record kept in Hermes Memory."""

    content: str
    kind: str
    record_id: str


class CLINVEXAMemory:
    """Provide deterministic view, search, and delete operations over Hermes Memory."""

    def __init__(self, store: MemoryStore) -> None:
        self._store = store

    def save(self, record: CLINVEXAMemoryRecord) -> None:
        """Save one structured CLINVEXA record.

        Args:
            record: Record with a unique identifier, kind, and content.

        Raises:
            ValueError: If the record is invalid or Hermes Memory rejects it.
        """
        if not record.record_id.strip() or not record.kind.strip() or not record.content.strip():
            raise ValueError("record fields cannot be empty")
        if "§" in record.content:
            raise ValueError("record content contains the memory delimiter")
        if self.search(record.record_id):
            raise ValueError(f"record already exists: {record.record_id}")

        encoded = _ENTRY_PREFIX + json.dumps(
            asdict(record),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        result = self._store.add("memory", encoded)
        if not result.get("success"):
            raise ValueError(str(result.get("error", "memory write failed")))

    def list(self) -> list[CLINVEXAMemoryRecord]:
        """Return every valid CLINVEXA record currently in Hermes Memory."""
        records: list[CLINVEXAMemoryRecord] = []
        for entry in self._store.memory_entries:
            record = self._decode(entry)
            if record is not None:
                records.append(record)
        return records

    def search(self, query: str) -> list[CLINVEXAMemoryRecord]:
        """Search CLINVEXA records by identifier, kind, or content.

        Args:
            query: Case-insensitive literal search text.

        Returns:
            Matching records in Memory order.
        """
        needle = query.strip().casefold()
        if not needle:
            return []
        return [
            record
            for record in self.list()
            if needle in record.record_id.casefold()
            or needle in record.kind.casefold()
            or needle in record.content.casefold()
        ]

    def delete(self, record_id: str) -> bool:
        """Delete one CLINVEXA record by exact identifier.

        Args:
            record_id: Exact record identifier.

        Returns:
            True when the record was removed, otherwise False.
        """
        matches = [record for record in self.list() if record.record_id == record_id]
        if len(matches) != 1:
            return False
        marker = f'"record_id":"{record_id}"'
        result = self._store.remove("memory", marker)
        return bool(result.get("success"))

    @staticmethod
    def _decode(entry: str) -> CLINVEXAMemoryRecord | None:
        if not entry.startswith(_ENTRY_PREFIX):
            return None
        try:
            payload = json.loads(entry.removeprefix(_ENTRY_PREFIX))
            return CLINVEXAMemoryRecord(
                content=str(payload["content"]),
                kind=str(payload["kind"]),
                record_id=str(payload["record_id"]),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None
