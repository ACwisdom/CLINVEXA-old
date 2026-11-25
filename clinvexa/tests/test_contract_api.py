from pathlib import Path
from urllib.parse import parse_qs
from uuid import uuid4

from fastapi.testclient import TestClient

from clinvexa import contract_api
from clinvexa.main import create_app


def make_client(root: Path, **options) -> TestClient:
    token = "synthetic-contract-session"
    return TestClient(
        create_app(skills_root=root / "skills", contracts_root=root / "contracts", contract_token=token, **options),
        headers={"X-Clinvexa-Contract-Session": token},
    )


def configure_test_oa(monkeypatch) -> None:
    for key, value in {
        "TEST_URL": "http://127.0.0.1:9999",
        "WORKFLOW_ID": "42",
        "FIELD_MAP": '{"counterparty":"field_vendor","amount":"field_amount","body":"field_body"}',
        "APPID": "test-license",
        "TOKEN": "test-token",
        "USERID": "test-ciphertext",
    }.items():
        monkeypatch.setenv(f"CLINVEXA_CONTRACT_OA_{key}", value)


def draft(amount: str = "12500") -> dict:
    return {
        "title": "=合同测试", "counterparty": "测试供应商", "project_number": "TEST-01", "amount": amount,
        "procurement_reference": "TEST-APPROVAL-01",
        "body": "合同总金额：12500元\n合同相对方：测试供应商\n付款、违约、争议条款。",
        "materials": {
            "tender": {"name": "招标.txt", "text": "项目编号：TEST-01"},
            "award": {"name": "中标.txt", "text": "中标单位：测试供应商\n中标金额：1.25万元"},
        },
    }


def test_review_blocks_mismatch_then_oa_receipt_can_be_archived(tmp_path, monkeypatch):
    configure_test_oa(monkeypatch)
    calls = []

    def post(url, body, headers, timeout):
        assert url.endswith("/api/workflow/paService/doCreateRequest")
        assert headers["token"] == "test-token"
        values = parse_qs(body.decode())
        assert values["workflowId"] == ["42"]
        assert '"fieldValue": "12500"' in values["mainData"][0]
        calls.append(values)
        return {"code": "SUCCESS", "data": {"requestid": 123}}

    monkeypatch.setattr(contract_api, "_post", post)
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    created = client.put(url, json={"revision": 0, "draft": draft("12000")})
    assert created.status_code == 200
    review = client.post(url + "/review", json={"revision": 1}).json()
    assert any("金额不一致" in finding["issue"] for finding in review["review"]["findings"])
    assert client.post(url + "/submit", json={"revision": review["revision"]}).status_code == 409
    assert not calls
    assert client.put(url, json={"revision": 1, "draft": draft()}).status_code == 409
    edited = client.put(url, json={"revision": review["revision"], "draft": draft()}).json()
    assert edited["review"] is None
    review = client.post(url + "/review", json={"revision": edited["revision"]}).json()
    submitted = client.post(url + "/submit", json={"revision": review["revision"]}).json()
    assert submitted["status"] == "submitted"
    assert submitted["oa_request_id"] == "123"
    assert client.post(url + "/submit", json={"revision": submitted["revision"]}).status_code == 409
    assert len(calls) == 1
    assert client.post(url + "/archive", json={"revision": submitted["revision"]}).status_code == 409
    approval = {"revision": submitted["revision"], "request_id": "123", "outcome": "approved"}
    assert client.post(url + "/receipt", json=approval).status_code == 422
    approved = client.post(url + "/receipt", json={**approval, "note": "测试审批已通过"}).json()
    assert client.post(url + "/archive", json={"revision": approved["revision"]}).status_code == 409
    pdf = client.get(url + "/pdf", params={"clean": "true"})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
    seal = client.post(
        url + "/seal", params={"revision": approved["revision"], "name": "用印.pdf", "verified": "true"}, content=pdf.content,
    )
    assert seal.status_code == 200, seal.text
    assert seal.json()["status"] == "sealed"
    assert client.get(url + "/sealed-copy").content == pdf.content
    archived = client.post(url + "/archive", json={"revision": seal.json()["revision"]}).json()
    assert archived["status"] == "archived"
    versions = client.get(url + "/versions").json()
    assert versions[0]["revision"] == 1
    diff = client.get(url + "/compare", params={"before": 1, "after": archived["revision"]}).json()
    assert any("12000" in line for block in diff for line in block["before"])
    assert any("12500" in line for block in diff for line in block["after"])
    assert make_client(tmp_path).get(url).json()["oa_request_id"] == "123"
    assert "'=合同测试" in client.get("/clinvexa/contracts/ledger.csv").content.decode("utf-8-sig")


def test_timeout_keeps_rule_review_and_prevents_duplicate_oa_submission(tmp_path, monkeypatch):
    configure_test_oa(monkeypatch)
    monkeypatch.setenv("CLINVEXA_CONTRACT_MODEL_URL", "http://127.0.0.1:9999/v1")
    monkeypatch.setenv("CLINVEXA_CONTRACT_MODEL_NAME", "test-model")
    monkeypatch.setenv("CLINVEXA_CONTRACT_MODEL_KEY", "test-key")
    calls = []

    def post(url, body, headers, timeout):
        calls.append(url)
        raise TimeoutError()

    monkeypatch.setattr(contract_api, "_post", post)
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    client.put(url, json={"revision": 0, "draft": draft()})
    reviewed = client.post(url + "/review", json={"revision": 1, "use_model": True}).json()
    assert reviewed["review"]["ai_status"] == "pending"
    assert any("AI 预审未完成" in finding["issue"] for finding in reviewed["review"]["findings"])
    result = client.post(url + "/submit", json={"revision": reviewed["revision"]}).json()
    assert result["status"] == "submission_unknown"
    assert client.post(url + "/submit", json={"revision": result["revision"]}).status_code == 409
    assert len(calls) == 2
    resolved = client.post(url + "/resolve-submission", json={"revision": result["revision"], "note": "已核对 OA 无对应流程"}).json()
    assert resolved["status"] == "reviewed"


def test_import_reads_utf8_and_extracts_amount_without_retaining_the_file(tmp_path):
    client = make_client(tmp_path)
    result = client.post("/clinvexa/contracts/extract", params={"name": "合同.txt"}, content=draft()["body"].encode())
    assert result.status_code == 200
    assert result.json()["fields"] == {"counterparty": "测试供应商", "amount": "12500"}
    assert client.post("/clinvexa/contracts/extract", params={"name": "程序.exe"}, content=b"data").status_code == 415
    assert client.get("/clinvexa/contracts").json()["records"] == []


def test_demo_workflow_is_isolated_and_reaches_archive(tmp_path, monkeypatch):
    monkeypatch.delenv("CLINVEXA_CONTRACT_DEMO", raising=False)
    assert make_client(tmp_path).post("/clinvexa/contracts/demo").status_code == 403
    monkeypatch.setenv("CLINVEXA_CONTRACT_DEMO", "1")
    client = make_client(tmp_path)
    result = client.post("/clinvexa/contracts/demo").json()
    assert result["procurement_route"] == "询价或磋商"
    url = f"/clinvexa/contracts/{result['id']}"
    result = client.post(url + "/review", json={"revision": result["revision"]}).json()
    assert result["review"]["findings"] == []
    result = client.post(url + "/submit", json={"revision": result["revision"]}).json()
    result = client.post(url + "/receipt", json={
        "revision": result["revision"], "request_id": result["oa_request_id"],
        "outcome": "approved", "note": "演示审批通过",
    }).json()
    assert "请核对续签" in result["reminders"][0]
    result = client.post(url + "/demo-seal", json={"revision": result["revision"]}).json()
    result = client.post(url + "/archive", json={"revision": result["revision"]}).json()
    assert result["status"] == "archived"
    assert client.get(url + "/sealed-copy").content.startswith(b"%PDF-")
    monkeypatch.delenv("CLINVEXA_CONTRACT_DEMO")
    assert make_client(tmp_path).get("/clinvexa/contracts").json()["records"] == []


def test_model_redraft_and_legal_note_are_visible_only_to_legal(tmp_path, monkeypatch):
    monkeypatch.delenv("CLINVEXA_CONTRACT_DEMO", raising=False)
    monkeypatch.delenv("CLINVEXA_CONTRACT_ROLE", raising=False)
    for key, value in {"URL": "http://127.0.0.1:9999/v1", "NAME": "test-model", "KEY": "test-key"}.items():
        monkeypatch.setenv(f"CLINVEXA_CONTRACT_MODEL_{key}", value)
    monkeypatch.setattr(contract_api, "_post", lambda *_args: {"choices": [{"message": {
        "content": '{"findings":[],"legal_summary":"仅法务可见","suggested_revision":"法务复核稿"}',
    }}]})
    ordinary = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    ordinary.put(url, json={"revision": 0, "draft": draft()})
    reviewed = ordinary.post(url + "/review", json={"revision": 1, "use_model": True}).json()
    assert reviewed["review"]["ai_status"] == "complete"
    assert reviewed["review"]["legal_summary"] == ""
    assert ordinary.post(url + "/legal-review", json={"revision": 2, "note": "无权写入"}).status_code == 403
    monkeypatch.setenv("CLINVEXA_CONTRACT_ROLE", "legal")
    legal = make_client(tmp_path)
    assert legal.get(url).json()["review"]["suggested_revision"] == "法务复核稿"
    assert legal.post(url + "/legal-review", json={"revision": 2, "note": "仅法务意见"}).json()["legal_note"] == "仅法务意见"
    assert ordinary.get(url).json()["legal_note"] == ""
