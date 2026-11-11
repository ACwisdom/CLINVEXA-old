"""Patient isolation, grounding, persisted drafts and real auxiliary transport."""
import asyncio
import base64
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from hermes_cli import clinvexa_copilot as copilot


def test_capture_window_rejects_invalid_handles_and_bounds_pending_work(monkeypatch):
    from pydantic import ValidationError
    for handle in ['0', '-1', 'screen', '1;2']:
        with pytest.raises(ValidationError):
            copilot.WindowCaptureRequest(windowId=handle)
    monkeypatch.setattr(copilot.sys, 'platform', 'win32')
    copilot._window_capture_lock.acquire()
    try:
        with pytest.raises(RuntimeError, match='pending'):
            copilot._capture_window_image('100')
    finally:
        copilot._window_capture_lock.release()


def test_capture_route_reports_failure_without_returning_an_unrelated_image(monkeypatch):
    def unavailable(_):
        raise OSError('closed target')
    monkeypatch.setattr(copilot, '_capture_window_image', unavailable)
    app = FastAPI()
    app.include_router(copilot.router)
    response = TestClient(app).post('/api/clinvexa/copilot/capture-window',json={'windowId':'100'})
    assert response.status_code == 503
    assert 'imageDataUrl' not in response.json()


@pytest.fixture
def frame():
    buffer = io.BytesIO()
    Image.new("RGB", (800, 600), "white").save(buffer, format="PNG")
    return dict(frameId="frame-A", windowId="100", title="Synthetic HIS", processName="test",
                capturedAt=1000, imageDataUrl="data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode())


def result(patient="A", encounter="E1", kind="field"):
    return dict(patientId=patient, patientName="同名患者", encounterId=encounter, scene="record", summary="合成资料",
                facts=["体温 36.5 ℃"], missing=[], suggestions=[dict(id="s1", kind=kind, title="体格检查",
                text="体温 36.5 ℃", reason="根据已读资料", evidence=["体温 36.5 ℃"], sourceIds=[], cautions=[], targetLabel="体格检查")])


def test_compact_wire_preserves_complete_source_and_target():
    text = '用药史：氨氯地平5mg每日一次，昨晚对乙酰氨基酚0.5g一次，未服抗菌药。过敏史：青霉素过敏。'
    fields = copilot._verbatim_fields(text)
    output = {'scene': 'record', 'summary': '病历', 'items': [
        {'title': value['title'], 'ref': key} for key, value in fields.items()]}
    decoded = copilot._decode(json.dumps(output), fields)
    assert len(decoded.suggestions) == 2
    assert decoded.suggestions[0].text == fields['v0']['text']
    assert decoded.suggestions[0].evidence == [fields['v0']['text']]
    assert decoded.suggestions[0].targetLabel == '用药史'
    assert len({item.id for item in decoded.suggestions}) == 2
    output.pop('scene')
    assert copilot._decode(json.dumps(output), fields).scene == 'other'
    output['items'][0]['title'] = '主诉'
    with pytest.raises(ValueError, match='source field'):
        copilot._decode(json.dumps(output), fields)


def test_stream_truncation_is_not_misreported_as_vision_capability():
    raw = copilot.ModelContent(json.dumps(result()), {'finishReason': 'length'})
    with pytest.raises(copilot.VisualModelError) as caught:
        copilot._decode(raw)
    assert caught.value.code == 'truncated'
    assert '截断' in str(caught.value)


def test_long_visible_record_preserves_all_fifteen_fields(monkeypatch, frame):
    fields = ['就诊日期', '科室', '患者', '性别', '年龄', '主诉', '现病史', '既往史',
              '家族史', '过敏史', '用药史', '体格检查', '辅助检查', '初步诊断', '处理记录']
    output = {'scene': 'record', 'summary': '完整病历', 'items': [
        {'title': title, 'text': f'{title}原文，待核实，无胸痛。', 'quote': '='} for title in fields]}
    api = client(monkeypatch, output)
    response = api.post('/api/clinvexa/copilot/analyze', json=frame)
    assert response.status_code == 200
    rows = response.json()['suggestions']
    assert [row['title'] for row in rows] == fields
    assert all(row['text'] == row['evidence'][0] for row in rows)
    assert len(copilot.list_results()[0]['suggestions']) == len(fields)


@pytest.mark.asyncio
async def test_format_recovery_is_bounded_and_revalidates(monkeypatch):
    calls = []
    async def model(messages, on_content=None):
        calls.append(messages)
        on_content('{')
        return '{"summary":' if len(calls) == 1 else json.dumps(result())
    monkeypatch.setattr(copilot, '_model', model)
    _, decoded = await copilot._analyze_model([{'role': 'system', 'content': copilot.SYSTEM_PROMPT}], {}, lambda _: None)
    assert decoded.patientId == 'A'
    assert len(calls) == 2
    assert 'json_syntax' in calls[1][0]['content']


@pytest.mark.parametrize('count,expected', [(25, 200), (26, 502)])
def test_visual_field_limit_is_25_without_silent_truncation(monkeypatch, frame, count, expected):
    output = {'scene': 'record', 'summary': '病历字段边界', 'items': [
        {'title': f'字段{i}', 'text': f'完整原文{i}', 'quote': '='} for i in range(count)]}
    api = client(monkeypatch, output)
    response = api.post('/api/clinvexa/copilot/analyze', json=frame)
    assert response.status_code == expected
    if expected == 200:
        assert len(response.json()['suggestions']) == count
    else:
        assert '超过 25 项' in response.json()['detail']
        assert copilot.list_results() == []


@pytest.mark.asyncio
async def test_format_recovery_never_retries_more_than_once(monkeypatch):
    calls = []
    async def model(messages, on_content=None):
        calls.append(1)
        on_content('{')
        return '{"summary":'
    monkeypatch.setattr(copilot, '_model', model)
    with pytest.raises(json.JSONDecodeError):
        await copilot._analyze_model([], {}, lambda _: None)
    assert len(calls) == 2


def test_reference_request_sends_full_medical_source_once(monkeypatch, frame):
    source = '主诉：腹痛3天。用药史：昨晚对乙酰氨基酚0.5g一次，未服抗菌药。'
    captured = []
    async def model(messages, **kwargs):
        context = json.loads(messages[1]['content'][0]['text'])
        captured.append(context)
        return json.dumps({'summary': '病历', 'items': [
            {'title': value['title'], 'ref': key} for key, value in context['verbatimFields'].items()]})
    monkeypatch.setattr(copilot, '_model', model)
    response = asyncio.run(copilot.analyze_screen(copilot.ScreenRequest(**frame, sourceText=source)))
    assert captured[0]['doctorSuppliedMaterial'] == source
    assert all(set(item) == {'title'} for item in captured[0]['verbatimFields'].values())
    assert response['suggestions'][1]['text'] == '昨晚对乙酰氨基酚0.5g一次，未服抗菌药。'


def test_office_document_followup_uses_only_the_current_recognition(monkeypatch, frame):
    contexts = []
    async def model(messages, **kwargs):
        context = json.loads(messages[1]['content'][0]['text'])
        contexts.append(context)
        return json.dumps({'scene': 'writing', 'summary': '营业执照信息已整理',
                           'items': [{'title': '名称', 'text': '中软信息技术创新有限公司', 'quote': '='}]}, ensure_ascii=False)
    monkeypatch.setattr(copilot, '_model', model)
    api = TestClient(FastAPI())
    api.app.include_router(copilot.router)
    first = api.post('/api/clinvexa/copilot/analyze', json=frame)
    assert first.status_code == 200
    followup = api.post('/api/clinvexa/copilot/analyze', json={**frame, 'question': '整理图片中的公司名称',
        'resultId': first.json()['id']})
    assert followup.status_code == 200
    assert followup.json()['suggestions'][0]['text'] == '中软信息技术创新有限公司'
    assert contexts[1]['previousRecognition']['items'][0]['text'] == '中软信息技术创新有限公司'
    other_frame = {**frame, 'frameId': 'frame-B', 'question': '分析当前图片', 'resultId': first.json()['id']}
    assert api.post('/api/clinvexa/copilot/analyze', json=other_frame).status_code == 200
    assert 'previousRecognition' not in contexts[2]


@pytest.mark.asyncio
async def test_request_disconnect_cancels_model_work(monkeypatch, frame):
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def blocked(body):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    class Request:
        async def is_disconnected(self):
            await entered.wait()
            return True
    monkeypatch.setattr(copilot, '_analyze_screen', blocked)
    with pytest.raises(asyncio.CancelledError):
        await copilot.analyze_screen(copilot.ScreenRequest(**frame), Request())
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_stalled_first_content_has_one_recovery_and_cancels_loser(monkeypatch):
    calls = []
    cancelled = asyncio.Event()
    async def model(messages, on_content=None):
        calls.append(1)
        if len(calls) == 1:
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        return json.dumps(result())
    monkeypatch.setattr(copilot, '_model', model)
    _, value = await copilot._analyze_model([], {}, lambda _: None, hedge_after=0.01)
    assert value.patientId == 'A' and len(calls) == 2
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_normal_stream_never_duplicates_requests(monkeypatch):
    calls = []
    async def model(messages, on_content=None):
        calls.append(1)
        on_content('{')
        await asyncio.sleep(0.03)
        return json.dumps(result())
    monkeypatch.setattr(copilot, '_model', model)
    await copilot._analyze_model([], {}, lambda _: None, hedge_after=0.01)
    assert len(calls) == 1


def client(monkeypatch, output):
    async def model(messages, timeout=22, on_content=None):
        return json.dumps(output, ensure_ascii=False)
    monkeypatch.setattr(copilot, "_model", model)
    app = FastAPI()
    app.include_router(copilot.router)
    return TestClient(app)


def test_patient_and_encounter_isolation(monkeypatch, frame):
    output = result()
    api = client(monkeypatch, output)
    a = api.post("/api/clinvexa/copilot/analyze", json=frame).json()
    output["patientId"] = "B"
    b = api.post("/api/clinvexa/copilot/analyze", json={**frame, "frameId": "B"}).json()
    output["patientId"] = "A"
    output["encounterId"] = "E2"
    later = api.post("/api/clinvexa/copilot/analyze", json={**frame, "frameId": "C"}).json()
    assert len({a["taskKey"], b["taskKey"], later["taskKey"]}) == 3
    assert all("imageDataUrl" not in row for row in api.get("/api/clinvexa/copilot/results").json())


def test_missing_identity_never_joins_same_name(monkeypatch, frame):
    api = client(monkeypatch, result(patient="", encounter=""))
    a = api.post("/api/clinvexa/copilot/analyze", json=frame).json()
    b = api.post("/api/clinvexa/copilot/analyze", json={**frame, "frameId": "next"}).json()
    assert a["taskKey"] != b["taskKey"]


def test_same_identifiers_in_different_applications_do_not_join(monkeypatch, frame):
    api = client(monkeypatch, result())
    a = api.post("/api/clinvexa/copilot/analyze", json=frame).json()
    b = api.post("/api/clinvexa/copilot/analyze", json={**frame, "processName": "another-hospital"}).json()
    assert a["taskKey"] != b["taskKey"]


def test_voice_material_requires_independent_matching_screen_identity(monkeypatch, frame):
    from hermes_constants import get_hermes_home
    consultation_id = "a" * 32
    directory = get_hermes_home() / 'clinvexa' / 'consultations' / consultation_id
    directory.mkdir(parents=True)
    (directory / 'consultation.json').write_text(json.dumps({
        'consent_confirmed': True, 'status': 'recording', 'patient_id': 'A',
        'transcript': '患者：咳嗽三天，青霉素过敏。', 'draft': {'chief_complaint': '咳嗽三天'},
        'segments': [{'sequence': 0}],
    }), encoding='utf-8')
    output = result()
    received = []
    async def model(messages, timeout=22, on_content=None):
        received.append(messages)
        return json.dumps(output)
    monkeypatch.setattr(copilot, '_model', model)
    app = FastAPI(); app.include_router(copilot.router)
    api = TestClient(app)
    body = {**frame, 'consultationId': consultation_id}
    response = api.post('/api/clinvexa/copilot/analyze', json=body)
    assert response.status_code == 200
    assert response.json()['consultationSegments'] == 1
    material = json.loads(received[0][1]['content'][0]['text'])['consultationMaterial']
    assert '青霉素过敏' in material['transcript']
    assert 'patient_id' not in material
    output['patientId'] = 'B'
    assert api.post('/api/clinvexa/copilot/analyze', json={**body, 'frameId': 'patient-B'}).status_code == 409
    assert len(api.get('/api/clinvexa/copilot/results').json()) == 1


def test_no_concrete_exams_without_reviewed_evidence(monkeypatch, frame):
    output = result(kind="examination")
    output["suggestions"][0]["sourceIds"] = ["model-invented-citation"]
    api = client(monkeypatch, output)
    response = api.post("/api/clinvexa/copilot/analyze", json=frame)
    assert response.status_code == 200
    assert response.json()["suggestions"] == []
    assert response.json()["missing"]


def test_reviewed_sources_are_enforced(monkeypatch, frame, tmp_path):
    from hermes_constants import get_hermes_home
    root = get_hermes_home() / "clinvexa" / "knowledge"
    root.mkdir(parents=True)
    source = dict(id="synthetic-source", title="合成来源（仅测试）", version="test-1", text="测试依据",
                  reviewed=True, reviewer="test reviewer", reviewedAt="2026-09-10")
    (root / "source.json").write_text(json.dumps(source), encoding="utf-8")
    output = result(kind="examination")
    output["suggestions"][0]["sourceIds"] = ["synthetic-source", "invented"]
    api = client(monkeypatch, output)
    response = api.post("/api/clinvexa/copilot/analyze", json=frame).json()
    assert response["suggestions"][0]["sourceIds"] == ["synthetic-source"]
    assert response["sources"][0]["version"] == "test-1"


def test_draft_survives_new_result_and_rejects_concurrent_overwrite(monkeypatch, frame):
    api = client(monkeypatch, result())
    original = api.post("/api/clinvexa/copilot/analyze", json=frame).json()
    path = f'/api/clinvexa/copilot/results/{original["id"]}/draft'
    saved = api.put(path, json={"revision": 0, "draft": "医生修改保留"})
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1
    assert api.put(path, json={"revision": 0, "draft": "另一个窗口的旧草稿"}).status_code == 409
    new = api.post("/api/clinvexa/copilot/analyze", json={**frame, "frameId": "next"}).json()
    rows = api.get("/api/clinvexa/copilot/results").json()
    assert next(row for row in rows if row["id"] == original["id"])["draft"] == "医生修改保留"
    assert new["draft"] == ""
    # A fresh connection simulates a process restart; no renderer-owned state involved.
    assert copilot.list_results()[1]["draft"] == "医生修改保留"
    assert api.put(path, json={"revision": 1, "draft": "医生第二版"}).status_code == 200
    versions = api.get(path.removesuffix('/draft') + '/versions').json()
    assert [row['draft'] for row in versions] == ['医生第二版', '医生修改保留']
    # Saved drafts remain reachable beyond the global recent-screen cap.
    with copilot._database() as db:
        for index in range(105):
            payload = {**new, 'id': f'new-{index}', 'createdAt': new['createdAt'] + index + 1}
            db.execute('INSERT INTO copilot_results(id,task_key,created,payload) VALUES(?,?,?,?)', (payload['id'], new['taskKey'], payload['createdAt'], json.dumps(payload)))
    assert original['id'] not in [row['id'] for row in copilot.list_results()]
    restored = api.get(f'/api/clinvexa/copilot/tasks/{original["taskKey"]}/results').json()
    assert next(row for row in restored if row['id'] == original['id'])['draft'] == '医生第二版'


def test_reviewed_knowledge_can_be_added_without_model_inventing_sources(monkeypatch, frame):
    api = client(monkeypatch, result())
    body = dict(title='合成依据', version='test-only', reviewer='测试审核', text='仅用于软件测试的合成资料，不是临床指南或检查建议。', reviewed=True, url='')
    assert api.post('/api/clinvexa/copilot/knowledge', json={**body, 'reviewed': False}).status_code == 422
    saved = api.post('/api/clinvexa/copilot/knowledge', json=body)
    assert saved.status_code == 200
    assert api.get('/api/clinvexa/copilot/knowledge').json()[0]['id'] == saved.json()['id']
    assert copilot._knowledge()[0]['text'] == body['text']


def test_bad_model_output_and_invalid_images_are_honest_failures(monkeypatch, frame):
    api = client(monkeypatch, {"summary": "missing required fields"})
    assert api.post("/api/clinvexa/copilot/analyze", json=frame).status_code == 502
    assert api.post("/api/clinvexa/copilot/analyze", json={**frame, "imageDataUrl": "https://example.com/"}).status_code == 422
    assert copilot.list_results() == []


def test_empty_suggestions_preserve_useful_facts_and_show_missing_material():
    value = result()
    value['suggestions'][0]['text'] = ''
    decoded = copilot._decode(json.dumps(value))
    assert decoded.suggestions == []
    assert decoded.facts == ['体温 36.5 ℃']
    assert '未生成可用内容' in decoded.missing[0]


def test_full_gateway_auth_protects_copilot(monkeypatch):
    from hermes_cli import web_server
    api = TestClient(web_server.app, base_url="http://127.0.0.1")
    assert api.get("/api/clinvexa/copilot/results").status_code == 401
    response = api.get("/api/clinvexa/copilot/results", headers={"X-Hermes-Session-Token": web_server._SESSION_TOKEN})
    assert response.status_code == 200


def test_actual_auxiliary_vision_transport(monkeypatch, frame):
    """Actual resolver + OpenAI client + HTTP, only the provider is a local test server."""
    from hermes_constants import get_hermes_home
    received = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            assert body["stream"] is True
            content = json.dumps(result())
            for piece in (content[:40], content[40:]):
                chunk = {"id": "local-test", "object": "chat.completion.chunk", "created": 1,
                    "model": "local-vision-test", "choices": [{"index": 0, "delta": {"content": piece}}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    config = {"model": {"provider": "custom", "default": "local-vision-test", "base_url": f"http://127.0.0.1:{server.server_port}/v1", "api_key": "local-test"},
              "auxiliary": {"vision": {"provider": "custom", "model": "local-vision-test", "base_url": f"http://127.0.0.1:{server.server_port}/v1", "api_key": "local-test"}}}
    (get_hermes_home() / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    try:
        response = asyncio.run(copilot.analyze_screen(copilot.ScreenRequest(**frame)))
        assert response["facts"] == ["体温 36.5 ℃"]
        content = received[0]["messages"][1]["content"]
        assert any(item.get("type") == "image_url" for item in content)
        assert not received[0].get("tools")
    finally:
        server.shutdown()
        server.server_close()
