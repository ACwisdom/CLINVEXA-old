from __future__ import annotations

from clinvexa.screen import ScreenContext, ScreenContextStore


def test_screen_context_store_retains_only_latest_window_and_honors_pause() -> None:
    store = ScreenContextStore()
    first = ScreenContext(
        captured_at="2026-08-04T10:00:00+08:00",
        process_name="synthetic-his.exe",
        title="合成患者 A - 门诊病历",
        window_id="1001",
    )
    second = ScreenContext(
        captured_at="2026-08-04T10:00:01+08:00",
        process_name="synthetic-lis.exe",
        title="合成患者 A - 检验结果",
        window_id="1002",
    )

    assert store.status == "monitoring"
    assert store.update(first) is True
    assert store.update(second) is True
    assert store.latest() == second

    store.pause()
    assert store.status == "paused"
    assert store.update(first) is False
    assert store.latest() == second

    store.resume()
    assert store.status == "monitoring"
    store.clear()
    assert store.latest() is None


def test_screen_context_rejects_empty_window_identity() -> None:
    context = ScreenContext(
        captured_at="2026-08-04T10:00:00+08:00",
        process_name="synthetic-his.exe",
        title="合成门诊病历",
        window_id="",
    )

    store = ScreenContextStore()

    try:
        store.update(context)
    except ValueError as error:
        assert str(error) == "screen context window identity cannot be empty"
    else:
        raise AssertionError("empty window identity was accepted")
