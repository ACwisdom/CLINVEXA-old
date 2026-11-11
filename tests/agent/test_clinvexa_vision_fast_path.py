"""No-network regressions for repeated screen assistance."""
import asyncio
from types import SimpleNamespace

import agent.auxiliary_client as aux
import agent.image_routing as routing
import agent.model_metadata as metadata
import pytest


def test_cloud_endpoint_never_probes_local_server(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Cloud endpoint must not run local discovery")

    monkeypatch.setattr(metadata, "detect_local_server_type", unexpected)
    assert not routing._should_probe_ollama_vision("custom", "https://dashscope.aliyuncs.com/compatible-mode/v1")


def test_custom_local_endpoint_keeps_discovery(monkeypatch):
    calls = []
    monkeypatch.setattr(metadata, "detect_local_server_type", lambda url: calls.append(url) or "ollama")
    assert routing._should_probe_ollama_vision("custom", "http://localhost:11434/v1")
    assert calls == ["http://localhost:11434/v1"]


@pytest.mark.asyncio
async def test_desktop_warms_the_sync_transport_used_by_streaming(monkeypatch):
    from hermes_cli import web_server
    import threading
    calls = []
    monkeypatch.setattr('tools.computer_use.permissions.computer_use_status', lambda: {'ready': True})
    monkeypatch.setattr('tools.transcription_tools.is_stt_enabled', lambda config: False)
    monkeypatch.setattr('hermes_cli.clinvexa_copilot.warm_window_capture', lambda: {'ready': True, 'state': 'ready'})
    def resolve(**kwargs):
        calls.append((kwargs.get('async_mode'), threading.current_thread() is threading.main_thread()))
        return 'fixture', object(), 'fixture-model'
    monkeypatch.setattr(aux, 'resolve_vision_provider_client', resolve)
    app = SimpleNamespace(state=SimpleNamespace())
    await web_server._warm_clinvexa_runtime_services(app)
    assert calls == [(False, False)]
    assert app.state.clinvexa_runtime_services['vision']['ready'] is True


@pytest.mark.asyncio
async def test_desktop_primes_http_pool_without_sending_a_completion(monkeypatch):
    from hermes_cli import web_server
    calls = []
    client = SimpleNamespace(models=SimpleNamespace(list=lambda: calls.append('list-models')))
    client.with_options = lambda **options: calls.append(options) or client
    monkeypatch.setattr('tools.computer_use.permissions.computer_use_status', lambda: {'ready': True})
    monkeypatch.setattr('tools.transcription_tools.is_stt_enabled', lambda config: False)
    monkeypatch.setattr('hermes_cli.clinvexa_copilot.warm_window_capture', lambda: {'ready': True})
    monkeypatch.setattr(aux,'resolve_vision_provider_client',lambda **kwargs: ('fixture',client,'fixture'))
    app = SimpleNamespace(state=SimpleNamespace())
    await web_server._warm_clinvexa_runtime_services(app)
    assert calls == [{'timeout':3,'max_retries':0},'list-models']
    assert app.state.clinvexa_runtime_services['vision']['connectionWarmed'] is True


def test_vision_reuses_transport_but_isolates_model_key_and_loop(monkeypatch):
    aux.shutdown_cached_clients()
    built = []
    monkeypatch.setattr(aux, "_resolve_task_provider_model", lambda *args: ("auto", args[2] or "vision-a", None, None, None))
    monkeypatch.setattr(aux, "_resolve_provider_vision_default", lambda provider: None)
    monkeypatch.setattr(aux, "_main_model_supports_vision", lambda *args: True)
    monkeypatch.setattr(aux, "_pool_cache_hint", lambda *args, **kwargs: "")
    monkeypatch.setattr(aux, "_peek_pool_entry", lambda *args: None)

    def resolve(provider, model=None, async_mode=False, **kwargs):
        client = SimpleNamespace(base_url="https://fixture.invalid/v1")
        built.append((model, async_mode, client))
        return client, model

    monkeypatch.setattr(aux, "resolve_provider_client", resolve)
    runtime = {"provider": "custom", "model": "main-text", "base_url": "https://fixture.invalid/v1", "api_key": "fixture"}

    async def visit():
        first = aux.resolve_vision_provider_client(async_mode=True, main_runtime=runtime)
        second = aux.resolve_vision_provider_client(async_mode=True, main_runtime=runtime)
        changed = aux.resolve_vision_provider_client(model="vision-b", async_mode=True, main_runtime=runtime)
        assert first[1] is second[1]
        assert changed[1] is not first[1]
        assert first[2] == "vision-a" and changed[2] == "vision-b"
        return first[1]

    try:
        original = asyncio.run(visit())
        later = asyncio.run(visit())
        assert original is not later
        assert len(built) == 4
        assert all(row[1] for row in built)
    finally:
        aux.shutdown_cached_clients()
