from datetime import timedelta
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4
from zipfile import ZipFile

import pytest
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen.canvas import Canvas

from clinvexa import contract_api, contract_review_api, contract_review_store
from clinvexa.contract_gate import GatePolicy
from test_contract_api import make_client


BODY = (
    "甲方：示例医院\n乙方：示例服务商\n项目编号：TEST-P0\n"
    "合同总金额：1.25万元\n付款：验收后支付全款。\n"
    "违约：按约承担责任。\n争议：双方协商处理。"
)


@pytest.fixture(autouse=True)
def isolated_contract_settings(monkeypatch):
    for name in ("DEMO", "ROLE", "MODEL_URL", "MODEL_NAME", "MODEL_KEY"):
        monkeypatch.delenv(f"CLINVEXA_CONTRACT_{name}", raising=False)


def upload(client, url, kind, name, data):
    response = client.post(url + "/review-documents", params={"kind": kind, "name": name},
                           content=data, headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 200, response.text
    return response.json()["document"]


def save(client, url, revision=0, **updates):
    draft = {
        "title": "合成服务合同", "body": BODY, "contract_type": "service", "hospital_party": "示例医院",
        "counterparty": "示例服务商", "project_number": "TEST-P0", "amount_direction": "expense",
        "amount_fixed": True, "funding_source": "示例资金", "amount": "12500",
        "procurement_required": False, "procurement_reference": "合成前置依据",
        **updates,
    }
    response = client.put(url, json={"revision": revision, "draft": draft})
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def start(client, url, revision, **options):
    response = client.post(url + "/review-jobs", json={"revision": revision, **options})
    assert response.status_code == 201, response.text
    return response.json()


def test_rehearsal_blocks_only_configured_reasons_without_changing_submit(tmp_path, monkeypatch):
    from hermes_cli import config

    def forbidden(*args):
        pytest.fail("The rehearsal must not call an external service")

    monkeypatch.setattr(contract_api, "_post", forbidden)
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "contract_preaudit:\n"
        "  block: [not_reviewed, high_risk_pending, high_risk_confirmed, needs_materials, review_incomplete]\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "get_config_path", lambda: config_path)
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url, amount="12000")
    endpoint = url + "/submission-rehearsal"

    def assess(*expected):
        response = client.post(endpoint, json={"revision": revision})
        assert response.status_code == 200
        result = response.json()
        assert result["simulation"] and result["allowed"] == (not expected)
        assert set(result["blocking"]) == set(expected)
        return result

    assess("not_reviewed")
    job = start(client, url, revision)
    assess("high_risk_pending")
    item = next(item for item in job["findings"] if item["rule_id"] == "CARD_AMOUNT")
    decision_url = url + f"/review-jobs/{job['id']}/findings/{item['id']}/decision"
    for step, (status, reasons) in enumerate([
        ("accepted", ("high_risk_confirmed",)),
        ("needs_evidence", ("high_risk_pending", "needs_materials")),
        ("dismissed", ()),
    ]):
        assert client.put(decision_url, json={"revision": step, "status": status, "note": "合成复核"}).status_code == 200
        assess(*reasons)

    revision = save(client, url, revision)
    assess("not_reviewed")
    start(client, url, revision, use_model=True)
    assert assess("review_incomplete")["model_status"] == "unavailable"
    assert client.get(url).json()["status"] == "draft"
    assert client.post(endpoint, json={"revision": revision, "exception_reason": "无权限"}).status_code == 403


def test_demo_exception_and_followup_are_version_bound_and_persisted(tmp_path, monkeypatch):
    monkeypatch.setenv("CLINVEXA_CONTRACT_DEMO", "1")
    monkeypatch.setenv("CLINVEXA_CONTRACT_ROLE", "legal")
    monkeypatch.setattr(contract_review_api, "load_gate_policy", lambda: GatePolicy(
        block=["not_reviewed", "high_risk_pending"], allow_exception=True,
    ))
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    other = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url)
    save(client, other)
    endpoint = url + "/submission-rehearsal"
    body = {"revision": revision, "exception_reason": "合成紧急放行理由"}
    grant = client.post(endpoint, json=body).json()
    exception = grant["exception"]
    assert grant["allowed"] and exception["state"] == "pending"
    assert client.post(endpoint, json=body).json()["exception"] == exception
    followup = f"/submission-rehearsal/{exception['id']}/followup"
    assert client.post(other + followup, json={"revision": revision}).status_code == 404
    assert client.post(url + followup, json={"revision": revision}).status_code == 409
    job = start(client, url, revision)
    reopened = make_client(tmp_path)
    resolved = reopened.post(url + followup, json={"revision": revision}).json()["exception"]
    assert resolved["state"] == "resolved" and resolved["followup_job_id"] == job["id"]
    assert reopened.post(endpoint, json={"revision": revision}).json()["exception"] == resolved
    assert reopened.get(url).json()["status"] == "draft"
    legacy = reopened.post(url + "/review", json={"revision": revision}).json()
    new_revision = {"revision": legacy["revision"]}
    assert not reopened.post(endpoint, json=new_revision).json()["allowed"]
    assert reopened.post(url + "/submit", json=new_revision).json()["status"] == "submitted"


def test_contract_token_blocks_reads_exports_and_writes(tmp_path):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url)
    document = upload(client, url, "contract", "合成正文.txt", BODY.encode())
    job = start(client, url, revision)
    reports = url + f"/review-jobs/{job['id']}/reports"
    report = client.post(reports, json={}).json()
    other = f"/clinvexa/contracts/{uuid4()}"
    save(client, other)
    assert client.get(f"{other}/review-jobs/{job['id']}/reports/{report['id']}").status_code == 404
    paths = [url, "/clinvexa/contracts/ledger.csv", "/clinvexa/contracts/risks.csv",
             f"{url}/review-documents/{document['id']}/original", f"{reports}/{report['id']}?format=csv"]
    assert client.get(url).headers["cache-control"] == "no-store"
    client.headers.clear()
    for path in paths:
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"X-Clinvexa-Contract-Session": "wrong"}).status_code == 401
    assert client.post(url + "/review-jobs", json={"revision": revision}).status_code == 401


@pytest.mark.parametrize(("direction", "fixed", "amount", "missing"), [
    ("none", None, None, False),
    ("income", False, None, False),
    ("expense", True, None, True),
    ("income", True, "0", False),
])
def test_amount_requirements_preaudit_and_legacy(tmp_path, direction, fixed, amount, missing):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url, amount_direction=direction, amount_fixed=fixed, amount=amount, body=BODY.replace("合同总金额：1.25万元\n", ""))
    job = start(client, url, revision)
    rule_ids = {item["rule_id"] for item in job["findings"]}
    assert ("REQUIRED_AMOUNT" in rule_ids) == missing
    assert ("BODY_AMOUNT" in rule_ids) == (fixed is True)
    legacy = client.post(url + "/review", json={"revision": revision})
    assert legacy.status_code == 200
    assert any(item["issue"] == "缺少合同金额" for item in legacy.json()["review"]["findings"]) == missing


def test_missing_fields_and_anchored_internal_conflict(tmp_path):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    initial = save(client, url)
    original = ("😀起始\n" + BODY + "\n服务结束日期：2027年1月2日").encode("utf-8")
    source = upload(client, url, "contract", "合同.txt", original)
    revision = save(client, url, initial, body=original.decode(), amount="12000", contract_type=None,
                    funding_source="", hospital_party="", ends_on="2027-01-03", preaudit_documents={"contract": source["id"]})
    job = start(client, url, revision)
    findings = {item["rule_id"]: item for item in job["findings"]}
    assert {"REQUIRED_CONTRACT_TYPE", "REQUIRED_FUNDING_SOURCE", "REQUIRED_HOSPITAL_PARTY"} <= findings.keys()
    assert findings["CARD_ENDS_ON"]["evidence"][0]["quote"] == "服务结束日期：2027年1月2日"
    quote = findings["CARD_AMOUNT"]["evidence"][0]
    assert quote["anchor"] == "line:5"
    assert quote["sha256"] == sha256(original).hexdigest()
    assert original.decode()[quote["start"]:quote["end"]] == quote["quote"] == "合同总金额：1.25万元"
    assert job["coverage"]["model"] == "skipped"
    assert client.get(url + f"/review-documents/{source['id']}/original").content == original
    wrong = f"/clinvexa/contracts/{uuid4()}"
    save(client, wrong)
    assert client.get(wrong + f"/review-documents/{source['id']}/original").status_code == 404


def pdf_samples():
    buffer = BytesIO()
    canvas = Canvas(buffer)
    canvas.drawString(40, 800, "Page two contract evidence")
    canvas.save()
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.add_page(PdfReader(buffer).pages[0])
    mixed = BytesIO()
    writer.write(mixed)

    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    scanned = BytesIO()
    writer.write(scanned)
    return mixed.getvalue(), scanned.getvalue()


def test_pdf_page_and_docx_paragraphs_empty_and_broken_inputs(tmp_path):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    initial = save(client, url)
    mixed, scanned = pdf_samples()
    assert upload(client, url, "award", "扫描件样本.pdf", scanned)["status"] == "ocr_required"
    assert upload(client, url, "award", "损坏.pdf", b"broken")["status"] == "failed"
    assert upload(client, url, "contract", "空.txt", b" \n")["status"] == "empty"
    pdf = upload(client, url, "contract", "两页.pdf", mixed)
    assert pdf["status"] == "partial"
    assert [segment["anchor"] for segment in pdf["segments"]] == ["page:2"]

    docx = BytesIO()
    with ZipFile(docx, "w") as file:
        file.writestr("word/document.xml", """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>合同金额：12500元</w:t></w:r></w:p>
        </w:tc></w:tr></w:tbl></w:body></w:document>""")
    source = upload(client, url, "contract", "表格.docx", docx.getvalue())
    revision = save(client, url, initial, body=source["text"], amount="12000", preaudit_documents={"contract": source["id"]})
    job = start(client, url, revision)
    quote = next(item for item in job["findings"] if item["rule_id"] == "CARD_AMOUNT")["evidence"][0]
    assert quote["anchor"] == "paragraph:2"
    assert quote["quote"] == "合同金额：12500元"

    revision = save(client, url, revision, body="正文已编辑\n" + source["text"], amount="12000",
                    preaudit_documents={"contract": source["id"]})
    edited = start(client, url, revision)
    quote = next(item for item in edited["findings"] if item["rule_id"] == "CARD_AMOUNT")["evidence"][0]
    assert quote["anchor"] == "line:3"
    assert quote["document_id"] != source["id"]
    assert any(doc["id"] == source["id"] for doc in edited["documents"])


def test_ocr_adapter_preserves_page_evidence_without_trusting_procurement(tmp_path):
    def recognize(source, pages):
        assert source.suffix == ".pdf" and pages == (1,)
        return {1: "项目编号：OTHER\n中标单位：另一公司\n中标金额：1.2万元", 9: "忽略非请求页"}

    client = make_client(tmp_path, contract_ocr=recognize)
    url = f"/clinvexa/contracts/{uuid4()}"
    initial = save(client, url)
    body = upload(client, url, "contract", "合同.txt", BODY.encode())
    _, scanned = pdf_samples()
    award = upload(client, url, "award", "扫描中标件.pdf", scanned)
    assert award["sha256"] == sha256(scanned).hexdigest() and award["status"] == "partial"
    assert [segment["anchor"] for segment in award["segments"]] == ["page:1"]
    assert "忽略非请求页" not in award["text"]
    revision = save(client, url, initial, procurement_required=True, preaudit_documents={
        "contract": body["id"], "award": award["id"],
    })
    job = start(client, url, revision)
    assert job["coverage"]["procurement_award"] == "not_checked"
    assert {item["rule_id"] for item in job["findings"] if item["scope"] == "procurement_award"} == {"AWARD_SOURCE"}

    contract = upload(client, url, "contract", "扫描合同.pdf", scanned)
    revision = save(client, url, revision, body=contract["text"], preaudit_documents={"contract": contract["id"]})
    job = start(client, url, revision)
    citation = next(item["evidence"][0] for item in job["findings"] if item["rule_id"] == "CARD_PROJECT_NUMBER")
    assert citation["reliability"] == "ocr_unverified" and citation["anchor"] == "page:1"
    assert contract["text"][citation["start"]:citation["end"]] == citation["quote"]


def test_ocr_failure_keeps_native_page(tmp_path):
    def unavailable(source, pages):
        raise TimeoutError("redacted adapter details")

    client = make_client(tmp_path, contract_ocr=unavailable)
    url = f"/clinvexa/contracts/{uuid4()}"
    save(client, url)
    mixed, _ = pdf_samples()
    document = upload(client, url, "contract", "混合样本.pdf", mixed)
    assert document["status"] == "partial"
    assert [segment["anchor"] for segment in document["segments"]] == ["page:2"]
    assert "redacted adapter details" not in str(document)


@pytest.mark.parametrize(("project", "expected"), [
    ("TEST-P0", {"AWARD_AMOUNT", "AWARD_COUNTERPARTY"}),
    ("OTHER", {"AWARD_PROJECT"}),
])
def test_procurement_compares_award_only_with_verified_same_project(tmp_path, project, expected):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    initial = save(client, url)
    source = upload(client, url, "contract", "合同.txt", BODY.encode())
    tender = upload(client, url, "tender", "招标.txt", "项目编号：TEST-P0。\n项目编号：TEST-P0\n项目编号：____".encode())
    _, scanned = pdf_samples()
    response = upload(client, url, "response", "响应.pdf", scanned)
    award = upload(client, url, "award", "中标.txt", f"项目编号：{project}\n中标单位：另一公司\n中标金额：1.2万元".encode())
    revision = save(client, url, initial, procurement_required=True, preaudit_documents={
        "contract": source["id"], "tender": tender["id"], "response": response["id"], "award": award["id"],
    })
    job = start(client, url, revision)
    assert job["status"] == "partial"
    assert job["coverage"]["procurement_tender"] == "complete"
    assert job["coverage"]["procurement_response"] == "not_checked"
    conflicts = [item for item in job["findings"] if item["scope"] == "procurement_award"]
    assert {item["rule_id"] for item in conflicts} == expected
    assert all(len(item["evidence"]) == 2 for item in conflicts)


def configure_model(monkeypatch):
    for key, value in {"URL": "http://127.0.0.1:9999/v1", "NAME": "test-model", "KEY": "isolated-test-key"}.items():
        monkeypatch.setenv(f"CLINVEXA_CONTRACT_MODEL_{key}", value)


@pytest.mark.parametrize(("result", "state"), [
    ("timeout", "timeout"),
    ("false_quote", "invalid"),
    ("wrong_type", "invalid"),
    ("valid", "complete"),
    ("unconfigured", "unavailable"),
])
def test_model_validation_and_degradation(tmp_path, monkeypatch, result, state):
    if result != "unconfigured":
        configure_model(monkeypatch)
    candidate = {
        "rule_id": "PAYMENT", "level": "advice", "anchor": "line:5", "quote": "验收后支付全款",
        "issue": "应明确付款起算日", "suggestion": "补充验收完成后的付款天数",
    }

    def post(url, data, headers, timeout):
        assert url.endswith("/v1/chat/completions")
        payload = json.loads(data)
        assert payload["response_format"]["type"] == "json_object"
        context = json.loads(payload["messages"][1]["content"])
        assert "PAYMENT" in context["rules"] and len(context["segments"]) == 7
        if result == "timeout":
            raise TimeoutError
        if result == "false_quote":
            candidate["quote"] = "不存在的付款条款"
        if result == "wrong_type":
            candidate["level"] = 1
        return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"findings": [candidate, candidate]})}}]}

    monkeypatch.setattr(contract_api, "_post", post)
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    job = start(client, url, save(client, url, amount="10000"), use_model=True)
    assert job["coverage"]["model"] == state
    assert job["status"] == ("completed" if result == "valid" else "partial")
    assert any(item["rule_id"] == "CARD_AMOUNT" and item["origin"] == "rule" for item in job["findings"])
    suggestions = [item for item in job["findings"] if item["origin"] == "model"]
    assert len(suggestions) == (1 if result == "valid" else 0)
    if suggestions:
        assert suggestions[0]["level"] == "advice"
        assert suggestions[0]["evidence"][0]["quote"] == candidate["quote"]
    assert "isolated-test-key" not in json.dumps(job)
    if result == "timeout":
        assert job["model"]["elapsed_ms"] >= 0
        monkeypatch.setattr(contract_review_api, "load_gate_policy", lambda: GatePolicy(block=["model_incomplete"]))
        gate = client.post(url + "/submission-rehearsal", json={"revision": job["contract_revision"]}).json()
        assert gate["model_status"] == "timeout" and not gate["allowed"]


def test_job_history_report_and_append_only_review_survive_restart(tmp_path):
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url, amount="10000")
    job = start(client, url, revision)
    assert start(client, url, revision, job_id=job["id"])["id"] == job["id"]
    assert client.post(url + "/review-jobs", json={"revision": revision, "job_id": job["id"], "use_model": True}).status_code == 409
    job_url = url + "/review-jobs/" + job["id"]
    finding = next(item for item in job["findings"] if item["rule_id"] == "CARD_AMOUNT")
    decision_url = job_url + f"/findings/{finding['id']}/decision"
    decision = {"revision": 0, "status": "needs_evidence", "note": "=合成复核备注"}
    assert client.put(decision_url, json={**decision, "reviewer": "伪造姓名"}).status_code == 422
    assert client.put(decision_url, json=decision).status_code == 200
    assert client.put(decision_url, json=decision).status_code == 409
    response = client.post(job_url + "/reports", json={})
    assert response.status_code == 201
    report = response.json()
    assert report["contract_revision"] == revision
    assert report["decisions"][finding["id"]][0]["status"] == "needs_evidence"
    assert client.put(decision_url, json={**decision, "revision": 1, "status": "accepted"}).status_code == 200
    save(client, url, revision, amount="12500", body="新版本")
    reopened = make_client(tmp_path)
    assert reopened.get(url + "/review-jobs").json()[0]["id"] == job["id"]
    history = reopened.get(job_url).json()
    assert history["findings"] == job["findings"]
    assert len(history["decisions"][finding["id"]]) == 2
    assert not history["decisions"][finding["id"]][-1]["identity_verified"]
    assert history["decisions"][finding["id"]][-1]["identity_source"] == "local_service_account"
    assert reopened.get(job_url + "/reports").json()[0]["id"] == report["id"]
    report_url = job_url + "/reports/" + report["id"]
    assert reopened.get(report_url).json() == report
    exported = reopened.get(report_url, params={"format": "csv"}).content.decode("utf-8-sig")
    assert "合同总金额：1.25万元" in exported and "'=合成复核备注" in exported


def test_interrupted_model_retains_rules_and_task_recovers(tmp_path, monkeypatch):
    configure_model(monkeypatch)
    client = make_client(tmp_path)
    url = f"/clinvexa/contracts/{uuid4()}"
    revision = save(client, url, amount="10000")

    def post(*args):
        monkeypatch.setattr(contract_review_store, "RUN_WINDOW", timedelta(seconds=-1))
        raise TimeoutError

    monkeypatch.setattr(contract_api, "_post", post)
    job = start(client, url, revision, use_model=True)
    assert job["status"] == "partial"
    assert job["coverage"]["rules"] == "complete"
    assert job["coverage"]["model"] == "interrupted"
    assert job["findings"]
    monkeypatch.setattr(contract_review_store, "RUN_WINDOW", timedelta(seconds=120))
    assert start(make_client(tmp_path), url, revision)["status"] == "completed"
