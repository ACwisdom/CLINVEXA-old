"""Business contract drafts, review and approval tracking."""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TEXT = 200_000
MaterialKind = Literal["tender", "response", "award"]
DocumentKind = Literal["contract", "tender", "response", "award"]
ContractStatus = Literal[
    "draft", "reviewed", "sending", "submission_unknown", "submitted",
    "approved", "rejected", "sealed", "archived",
]
MATERIAL_LABELS = {"tender": "招标文件", "response": "响应文件", "award": "中标通知书"}
TEMPLATE = "业务合同\n\n合同相对方：\n项目编号：\n合同总金额：\n\n一、标的及履约期限\n\n二、验收及付款安排\n\n三、违约责任\n\n四、争议解决"
TEMPLATES = {
    "business": {"label": "通用业务合同", "body": TEMPLATE},
    "purchase": {"label": "货物采购合同", "body": TEMPLATE.replace("标的及履约期限", "货物规格、数量及交付期限")},
    "service": {"label": "服务合同", "body": TEMPLATE.replace("标的及履约期限", "服务范围、服务期限及成果")},
}
LOCKED_HEADER = "CLINVEXA 业务合同｜合同编号、版本、相对方及金额由系统从合同卡片生成。"
SHANGHAI = timezone(timedelta(hours=8))

FIELD_PATTERNS = {
    "counterparty": r"(?:合同相对方|相对方|乙方|中标供应商(?:名称)?|中标单位(?:名称)?|中标人(?:名称)?|供应商名称)[ \t]*[：:][ \t]*([^\n；;]+)",
    "project_number": r"(?:招标编号|项目编号|采购编号)[ \t]*[：:][ \t]*([^\n；;]+)",
}
AMOUNT_PATTERN = re.compile(
    r"(合同总金额|合同金额|合同总价|中标金额|中标总价|中标价|投标总价|投标报价)"
    r"[ \t]*[：:][ \t]*(?:人民币[ \t]*)?[¥￥]?[ \t]*([0-9][0-9,，]*(?:\.[0-9]+)?)"
    r"[ \t]*(万元|元)?"
)


class ContractError(ValueError):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


class Material(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class ContractDraft(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    counterparty: str = Field(default="", max_length=200)
    project_number: str = Field(default="", max_length=100)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    body: str = Field(default="", max_length=MAX_TEXT)
    materials: dict[MaterialKind, Material] = Field(default_factory=dict)
    template_id: Literal["business", "purchase", "service"] = "business"
    procurement_required: bool = True
    procurement_reference: str = Field(default="", max_length=250)
    contract_type: Literal["business", "purchase", "service"] | None = None
    hospital_party: str = Field(default="", max_length=200)
    amount_direction: Literal["income", "expense", "none"] | None = None
    amount_fixed: bool | None = None
    funding_source: str = Field(default="", max_length=200)
    preaudit_documents: dict[DocumentKind, UUID] = Field(default_factory=dict)
    starts_on: date | None = None
    ends_on: date | None = None

    @model_validator(mode="after")
    def validate_period(self) -> ContractDraft:
        if self.starts_on and self.ends_on and self.starts_on > self.ends_on:
            raise ValueError("履行结束日期不能早于开始日期")
        return self


class Finding(BaseModel):
    level: Literal["blocking", "warning", "advice"]
    source: str = Field(max_length=255)
    issue: str = Field(max_length=1000)
    suggestion: str = Field(max_length=1000)


class ContractReview(BaseModel):
    findings: list[Finding]
    ai_status: Literal["not_configured", "complete", "pending"]
    legal_summary: str = ""
    suggested_revision: str = ""


class ContractEvent(BaseModel):
    status: ContractStatus
    at: datetime
    note: str = ""


class ContractRecord(BaseModel):
    id: UUID
    revision: int
    status: ContractStatus
    draft: ContractDraft
    review: ContractReview | None = None
    oa_request_id: str | None = None
    events: list[ContractEvent]
    signed_name: str | None = None
    signed_sha256: str | None = None
    signed_check: Literal["matched", "different", "manual"] | None = None
    legal_note: str = ""

    def transition(self, status: ContractStatus, note: str = "", **changes: object) -> ContractRecord:
        return self.model_copy(update={
            "revision": self.revision + 1,
            "status": status,
            "events": [*self.events, ContractEvent(status=status, at=datetime.now(timezone.utc), note=note)],
            **changes,
        })


class DraftUpdate(BaseModel):
    revision: int = Field(ge=0)
    draft: ContractDraft


class ApprovalUpdate(BaseModel):
    revision: int = Field(ge=1)
    request_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    outcome: Literal["submitted", "approved", "rejected"]
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def require_outcome_evidence(self) -> ApprovalUpdate:
        if self.outcome != "submitted" and not self.note.strip():
            raise ValueError("请填写从 OA 核实的审批结论")
        return self


def extract_fields(text: str) -> dict[str, str]:
    fields = {}
    for name, pattern in FIELD_PATTERNS.items():
        if match := re.search(pattern, text):
            fields[name] = match.group(1).strip()
    amounts = set()
    for match in AMOUNT_PATTERN.finditer(text):
        value = Decimal(match.group(2).replace(",", "").replace("，", ""))
        if match.group(3) == "万元":
            value *= 10_000
        amounts.add(value)
    if len(amounts) == 1:
        fields["amount"] = format(amounts.pop(), "f")
    return fields


def requires_amount(draft: ContractDraft) -> bool:
    return draft.amount_direction != "none" and draft.amount_fixed is not False


def procurement_route(draft: ContractDraft) -> str:
    if not draft.procurement_required:
        return "无需招采"
    if not requires_amount(draft):
        return "待核对招采依据"
    if draft.amount is None:
        return "待填写金额"
    if draft.amount <= 100_000:
        return "院内备案"
    if draft.amount <= 300_000:
        return "询价或磋商"
    return "委外招标"


def reminders(record: ContractRecord, today: date | None = None) -> list[str]:
    today = today or datetime.now(SHANGHAI).date()
    items = []
    if record.status in {"approved", "sealed"}:
        approved = next((event for event in reversed(record.events) if event.status == "approved"), None)
        if approved:
            days = (today - approved.at.astimezone(SHANGHAI).date()).days
            tier = next((tier for tier in (90, 30, 3) if days >= tier), None)
            if tier:
                items.append(f"归档提醒 · 已通过 {days} 天（{tier} 天级）")
    if record.status in {"approved", "sealed", "archived"} and record.draft.ends_on:
        days = (record.draft.ends_on - today).days
        if days <= 30:
            items.append(f"履行期已到期 {abs(days)} 天" if days < 0 else f"距离到期 {days} 天，请核对续签")
    return items


def rule_findings(draft: ContractDraft) -> list[Finding]:
    findings = []
    required = [("合同正文", draft.body), ("合同相对方", draft.counterparty)]
    if requires_amount(draft):
        required.append(("合同金额", draft.amount))
    for label, value in required:
        if value is None or value == "":
            findings.append(Finding(level="blocking", source="起草", issue=f"缺少{label}", suggestion="补充并重新预审"))
    if draft.amount is not None and not requires_amount(draft):
        findings.append(Finding(level="blocking", source="起草", issue="固定金额与金额条件冲突", suggestion="核对金额条件并清除不适用的金额"))
    if any(draft.body == template["body"] for template in TEMPLATES.values()):
        findings.append(Finding(level="blocking", source="合同正文", issue="正文仍是空白模板", suggestion="填写实际合同条款"))
    if not draft.procurement_reference:
        label = "招采前置审批编号" if draft.procurement_required else "无需招采的依据"
        findings.append(Finding(level="blocking", source="前置程序", issue=f"缺少{label}", suggestion="核对院内审批后补充依据"))

    expected = {"counterparty": draft.counterparty, "project_number": draft.project_number, "amount": draft.amount if requires_amount(draft) else None}
    labels = {"counterparty": "相对方", "project_number": "项目编号", "amount": "金额"}
    sources = {"合同正文": extract_fields(draft.body)}
    if draft.procurement_required and not draft.materials:
        findings.append(Finding(level="warning", source="招采材料", issue="未导入招采材料，无法完成一致性校验", suggestion="适用时导入招标、响应及中标材料"))
    elif not draft.project_number:
        findings.append(Finding(level="warning", source="起草", issue="未填写项目编号", suggestion="核对招采材料并补充项目编号"))
    for kind, material in draft.materials.items():
        source = f"{MATERIAL_LABELS[kind]} · {material.name}"[:255]
        fields = extract_fields(material.text)
        # Bid prices and vendor names are not the awarded price and counterparty.
        if kind != "award":
            fields = {key: value for key, value in fields.items() if key == "project_number"}
        sources[source] = fields
        if not fields:
            findings.append(Finding(level="warning", source=source, issue="未识别出可用于比对的明确字段", suggestion="对照原件人工核验"))
    for source, fields in sources.items():
        for key, value in fields.items():
            target = expected[key]
            if target is None or target == "":
                continue
            matches = Decimal(value) == target if key == "amount" else re.sub(r"\s+", "", value) == re.sub(r"\s+", "", str(target))
            if not matches:
                findings.append(Finding(
                    level="blocking", source=source,
                    issue=f"{labels[key]}不一致：材料为 {value[:220]}，起草为 {target}",
                    suggestion="核对原文和前置审批，修订后重新预审",
                ))
    if draft.materials and ("award" not in draft.materials or not all(
        key in extract_fields(draft.materials["award"].text) for key in ("counterparty", "amount")
    )):
        findings.append(Finding(level="warning", source="中标通知书", issue="中标方或中标金额未完整比对", suggestion="补齐材料或人工核验"))
    for pattern, label in ((r"付款|支付|结算", "付款安排"), (r"违约", "违约责任"), (r"争议|管辖|仲裁", "争议解决")):
        if label == "付款安排" and draft.amount_direction == "none":
            continue
        if draft.body and not re.search(pattern, draft.body):
            findings.append(Finding(level="warning", source="合同正文", issue=f"未识别到{label}", suggestion="由经办人或法务核对条款"))
    return findings


def require_reviewed(record: ContractRecord) -> None:
    if record.status != "reviewed" or record.review is None:
        raise ContractError("请先保存并完成当前版本预审")
    if any(item.level == "blocking" for item in [*record.review.findings, *rule_findings(record.draft)]):
        raise ContractError("请处理阻断问题并重新预审")


class ContractStore:
    """Store a contract and its approval history together with revision checks."""

    def __init__(self, root: Path):
        self.path = root / "contracts.sqlite3"

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_versions "
                "(id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, revision))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_signed_copies "
                "(id TEXT PRIMARY KEY, data BLOB NOT NULL)"
            )
        except Exception:
            db.close()
            raise
        return db

    def get(self, contract_id: UUID) -> ContractRecord:
        with closing(self._connect()) as db:
            row = db.execute("SELECT payload FROM contracts WHERE id = ?", (str(contract_id),)).fetchone()
        if not row:
            raise ContractError("合同不存在", 404)
        return ContractRecord.model_validate_json(row[0])

    def list(self) -> list[ContractRecord]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT payload FROM contracts ORDER BY rowid DESC").fetchall()
        return [ContractRecord.model_validate_json(row[0]) for row in rows]

    def create(self, contract_id: UUID, draft: ContractDraft) -> ContractRecord:
        record = ContractRecord(
            id=contract_id, draft=draft, status="draft", revision=1,
            events=[ContractEvent(status="draft", at=datetime.now(timezone.utc))],
        )
        with closing(self._connect()) as db, db:
            inserted = db.execute(
                "INSERT OR IGNORE INTO contracts VALUES (?, ?, ?)",
                (str(contract_id), record.revision, record.model_dump_json()),
            ).rowcount
            if inserted:
                self._snapshot(db, record)
        if inserted:
            return record
        existing = self.get(contract_id)
        if existing.revision == 1 and existing.draft == draft:
            return existing
        raise ContractError("该合同已存在，请重新打开后编辑")

    @staticmethod
    def _snapshot(db: sqlite3.Connection, record: ContractRecord) -> None:
        db.execute("INSERT OR IGNORE INTO contract_versions VALUES (?, ?, ?)", (
            str(record.id), record.revision, record.model_dump_json(),
        ))

    def versions(self, contract_id: UUID) -> list[ContractRecord]:
        current = self.get(contract_id)
        with closing(self._connect()) as db:
            versions = [
                ContractRecord.model_validate_json(row[0]) for row in db.execute(
                    "SELECT payload FROM contract_versions WHERE id = ? ORDER BY revision", (str(contract_id),),
                )
            ]
        if not versions or versions[-1].revision < current.revision:
            versions.append(current)
        return versions

    def signed_copy(self, contract_id: UUID) -> bytes:
        with closing(self._connect()) as db:
            row = db.execute("SELECT data FROM contract_signed_copies WHERE id = ?", (str(contract_id),)).fetchone()
        if not row:
            raise ContractError("未登记用印件", 404)
        return row[0]

    def update(self, record: ContractRecord, signed_copy: bytes | None = None) -> ContractRecord:
        with closing(self._connect()) as db, db:
            row = db.execute("SELECT payload FROM contracts WHERE id = ? AND revision = ?", (
                str(record.id), record.revision - 1,
            )).fetchone()
            if not row:
                raise ContractError("合同已被更新，请重新打开后再试")
            previous = ContractRecord.model_validate_json(row[0])
            changed = db.execute(
                "UPDATE contracts SET revision = ?, payload = ? WHERE id = ? AND revision = ?",
                (record.revision, record.model_dump_json(), str(record.id), record.revision - 1),
            ).rowcount
            if changed != 1:
                raise ContractError("合同已被更新，请重新打开后再试")
            if previous.draft != record.draft or record.status in {"submitted", "approved", "sealed", "archived"}:
                self._snapshot(db, previous)
                self._snapshot(db, record)
            if signed_copy is not None:
                db.execute("INSERT INTO contract_signed_copies VALUES (?, ?)", (str(record.id), signed_copy))
        return record
