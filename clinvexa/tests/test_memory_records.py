from __future__ import annotations

from clinvexa.memory import CLINVEXAMemory, CLINVEXAMemoryRecord
from tools.memory_tool import MemoryStore


def test_twenty_synthetic_records_are_viewable_searchable_and_deletable(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    store = MemoryStore(memory_char_limit=20_000, user_char_limit=20_000)
    store.load_from_disk()
    memory = CLINVEXAMemory(store)

    for index in range(20):
        memory.save(
            CLINVEXAMemoryRecord(
                content=f"合成患者偏好 {index:02d}：复诊提醒采用简短表达",
                kind="patient_preference",
                record_id=f"SYN-MEM-{index:02d}",
            )
        )

    exact_hits = sum(
        memory.search(f"SYN-MEM-{index:02d}")[0].record_id == f"SYN-MEM-{index:02d}"
        for index in range(20)
    )
    assert exact_hits >= 19
    assert len(memory.list()) == 20

    assert memory.delete("SYN-MEM-07") is True
    assert memory.search("SYN-MEM-07") == []
    assert len(memory.list()) == 19
