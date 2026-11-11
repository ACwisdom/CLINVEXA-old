"""Local-agent boundary: platform authorization without clinical input upload."""
import asyncio
import hashlib
import io
import json
from types import SimpleNamespace
from zipfile import ZipFile

import httpx
import pytest

from hermes_cli import clinvexa_platform as platform


@pytest.fixture(autouse=True)
def isolated_connection(monkeypatch):
    monkeypatch.setattr(platform, "_client", None)
    monkeypatch.setattr(platform, "_account", {})
    monkeypatch.setattr(platform, "_origin", "https://platform.test")
    monkeypatch.setattr(platform, "_tasks", {})
    monkeypatch.setattr(platform, "_connection_lock", asyncio.Lock())


def package(operation="model", extra=None):
    value = {"schema_version": "1.0", "workflow": {"nodes": [
        {"id": "prompt", "operation": "prompt", "config": {"template_path": "prompts/task.md"}},
        {"id": "model", "operation": operation, "config": {}},
    ], "edges": [{"from": "prompt", "to": "model"}]}}
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("manifest.json", json.dumps(value))
        archive.writestr("prompts/task.md", "整理提供的资料，保留不确定信息。")
        if extra: archive.writestr(*extra)
    data = stream.getvalue()
    return data, hashlib.sha256(data).hexdigest()


def test_compile_real_archive_preserves_instructions_and_hash():
    data, digest = package()
    assert platform.compile_package(data, digest)["instructions"] == ["整理提供的资料，保留不确定信息。"]
    with pytest.raises(ValueError): platform.compile_package(data, "0" * 64)


@pytest.mark.parametrize("operation,extra", [("approved_skill", None), ("shell", None), ("model", ("../unsafe.md", "text"))])
def test_reject_unsupported_execution_and_paths(operation, extra):
    with pytest.raises(ValueError): platform.compile_package(*package(operation, extra))


@pytest.mark.parametrize("url", ["http://remote.example", "https://u:p@example.com", "https://example.com/other", "file:///x"])
def test_reject_insecure_or_credential_bearing_origins(url):
    with pytest.raises(ValueError): platform.normalize_origin(url)


def test_patient_input_never_reaches_platform_and_run_survives_ui(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    data, digest = package()
    seen = []
    real_client = httpx.AsyncClient
    def transport(request):
        seen.append((request.method, str(request.url), request.content.decode()))
        if request.url.host == "objects.test": return httpx.Response(200, content=data)
        return httpx.Response(200, json={"protocol": "clinvexa-local-v1", "execution": "clinvexa", "name": "整理助手", "version": "1.0.0", "sha256": digest, "download_url": "https://objects.test/package.zip"})
    monkeypatch.setattr(platform.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(transport), **kwargs))
    received = []
    async def model(recipe, text, on_content=None):
        received.append(text)
        return "医生核对稿"
    monkeypatch.setattr(platform, "_invoke_model", model)
    async def visit():
        platform._client = real_client(base_url="https://platform.test", transport=httpx.MockTransport(transport))
        platform._account = {"id": "doctor-test"}
        payload = platform.Invocation(installation_id="11111111-1111-1111-1111-111111111111", request_id="22222222-2222-2222-2222-222222222222", text="合成患者小王头痛三天")
        try:
            first = await platform.start_run(payload)
            await platform._tasks[first["id"]]
            replay = await platform.start_run(payload)
            assert replay["status"] == "completed"
            assert len(received) == 1
            history = await platform.recent_runs()
            assert history["items"][0]["output"] == "医生核对稿"
        finally:
            await platform._client.aclose(); platform._client = None; platform._account = {}
    asyncio.run(visit())
    assert received == ["合成患者小王头痛三天"]
    assert all(method == "GET" and not body for method, url, body in seen)
    assert all("小王" not in url for method, url, body in seen)


def test_revoked_grant_never_calls_model(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    async def forbidden(*args): raise AssertionError("Revoked installation must not execute")
    monkeypatch.setattr(platform, "_invoke_model", forbidden)
    row = {"id": "test", "account_id": "doctor", "installation_id": "old", "created_at": 1, "input": "合成病例", "output": "", "status": "running"}
    async def visit():
        async with httpx.AsyncClient(base_url="https://platform.test", transport=httpx.MockTransport(lambda request: httpx.Response(404))) as client:
            await platform._run(row, client)
    asyncio.run(visit())
    assert row["status"] == "failed" and row["output"] == ""


@pytest.mark.parametrize('origin', ['https://platform.test', 'http://localhost:8003'])
def test_login_uses_existing_account_and_keeps_cookie_out_of_renderer(monkeypatch, origin):
    real_client = httpx.AsyncClient
    requests = []
    def transport(request):
        requests.append(request)
        if request.url.path.endswith('/auth/login'):
            assert json.loads(request.content) == {"email": "synthetic@example.com", "password": "test-only"}
            return httpx.Response(200, json={"id": "same-user"}, headers={"set-cookie": "session=opaque; Path=/; HttpOnly; Secure"})
        assert request.headers.get('cookie') == 'session=opaque'
        if request.url.path.endswith('/capabilities'):
            return httpx.Response(200, json={"protocol": "clinvexa-local-v1"})
        return httpx.Response(200, json={"id": "same-user", "display_name": "测试医生", "csrf_token": "csrf-test"})
    monkeypatch.setattr(platform.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(transport), **kw))
    async def visit():
        result = await platform.connect(platform.Connect(url=origin, email='synthetic@example.com', password='test-only'))
        assert result == {"connected": True, "url": origin, "display_name": "测试医生", "execution": "clinvexa", "account_id": origin + "|same-user"}
        assert platform._identity() == origin + '|same-user'
        await platform.disconnect()
        assert platform._client is None
        assert requests[-1].headers['X-CSRF-Token'] == 'csrf-test'
    asyncio.run(visit())


def test_cancel_before_coroutine_starts_persists_and_switch_accounts_isolated(monkeypatch, tmp_path):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    async def forbidden(*args):
        raise AssertionError('Cancelled before start')
    monkeypatch.setattr(platform, '_run', forbidden)
    async def visit():
        async with httpx.AsyncClient(base_url='https://platform.test') as client:
            platform._client = client
            platform._account = {'id': 'doctor-a'}
            payload = platform.Invocation(installation_id='11111111-1111-1111-1111-111111111111', request_id='22222222-2222-2222-2222-222222222222', text='合成测试')
            row = await platform.start_run(payload)
            await platform.stop_run(row['id'])
            assert (await platform.recent_runs())['items'][0]['status'] == 'cancelled'
            for origin, identity in [('https://platform.test', 'doctor-b'), ('https://other-platform.test', 'doctor-a')]:
                platform._origin = origin
                platform._account = {'id': identity}
                assert (await platform.recent_runs())['items'] == []
                with pytest.raises(platform.HTTPException) as error:
                    await platform.start_run(payload)
                assert error.value.status_code == 409
                with pytest.raises(platform.HTTPException) as error:
                    await platform.stop_run(row['id'])
                assert error.value.status_code == 404
    asyncio.run(visit())


@pytest.mark.parametrize('key', ['$ref', '$dynamicRef', '$recursiveRef'])
def test_result_schema_cannot_fetch_remote_references(key):
    with pytest.raises(ValueError):
        platform._validate_schema({key: 'https://example.test/schema'})


def test_account_switch_cannot_race_run_start(monkeypatch, tmp_path):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    async def visit():
        entered, release = asyncio.Event(), asyncio.Event()
        async def connect_wait(payload):
            entered.set()
            await release.wait()
            platform._account = {'id': 'new-account'}
            return {}
        monkeypatch.setattr(platform, '_connect', connect_wait)
        async def no_run(row, client):
            row.update(status='completed')
            platform._save(row)
        monkeypatch.setattr(platform, '_run', no_run)
        async with httpx.AsyncClient() as client:
            platform._client = client
            platform._account = {'id': 'old-account'}
            connection = asyncio.create_task(platform.connect(platform.Connect(url='https://platform.test', email='synthetic@example.com', password='test-only')))
            await entered.wait()
            invocation = asyncio.create_task(platform.start_run(platform.Invocation(installation_id='11111111-1111-1111-1111-111111111111', request_id='33333333-3333-3333-3333-333333333333', text='合成测试')))
            await asyncio.sleep(0)
            assert not invocation.done()
            release.set()
            await connection
            row = await invocation
            assert row['account_id'].endswith('|new-account')
            await asyncio.gather(*list(platform._tasks.values()))
    asyncio.run(visit())


def test_prepare_for_main_chat_rechecks_authorization_without_sending_task(monkeypatch):
    data, digest = package()
    requests = []
    real_client = httpx.AsyncClient
    def transport(request):
        requests.append(request)
        if request.url.host == 'objects.test':
            assert 'cookie' not in request.headers
            return httpx.Response(200, content=data)
        return httpx.Response(200, json={'protocol': 'clinvexa-local-v1', 'execution': 'clinvexa',
            'name': '会议助手', 'version': '1.0', 'download_url': 'https://objects.test/package.zip', 'sha256': digest})
    monkeypatch.setattr(platform.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(transport), **kw))
    monkeypatch.setattr(platform, '_account', {'id': 'owner'})
    async def visit():
        async with httpx.AsyncClient(base_url='https://platform.test', cookies={'session': 'opaque'}) as client:
            monkeypatch.setattr(platform, '_client', client)
            payload = platform.PrepareInvocation(installation_id='11111111-1111-1111-1111-111111111111', account_id=platform._identity(), text='synthetic-private-meeting')
            result = await platform.prepare_invocation(payload)
            assert '整理提供的资料' in result['invocation']
            assert 'synthetic-private-meeting' in result['invocation']
            assert 'synthetic-private-meeting' not in str([(str(r.url), r.content) for r in requests])
            await platform.prepare_invocation(payload)
            assert sum('/grant' in str(r.url) for r in requests) == 2
            payload.account_id = 'https://platform.test|someone-else'
            with pytest.raises(platform.HTTPException) as exc:
                await platform.prepare_invocation(payload)
            assert exc.value.status_code == 409
    asyncio.run(visit())


def test_prepare_rejects_revoked_grant_without_fallback(monkeypatch):
    real_client = httpx.AsyncClient
    async def visit():
        async with real_client(base_url='https://platform.test', transport=httpx.MockTransport(lambda r: httpx.Response(403))) as client:
            monkeypatch.setattr(platform, '_client', client)
            with pytest.raises(platform.HTTPException):
                await platform.prepare_invocation(platform.PrepareInvocation(installation_id='11111111-1111-1111-1111-111111111111', account_id=platform._identity(), text='task'))
    asyncio.run(visit())
