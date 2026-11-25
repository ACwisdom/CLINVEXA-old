"""Versioned P0 checks using the saved contract and document snapshots."""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from decimal import Decimal
from uuid import uuid4

from clinvexa.contract_evidence import evidence
from clinvexa.contracts import AMOUNT_PATTERN, FIELD_PATTERNS, MATERIAL_LABELS, TEMPLATES, ContractDraft, requires_amount

RULE_SET = {"id": "business-contracts", "version": "p0-1", "source": "CLINVEXA 业务合同试运行规则"}
CLAUSE_RULES = {
    "PAYMENT": (r"付款|支付|结算", "付款安排"),
    "DELIVERY": (r"交付|履行|验收|服务期限|服务范围|供货|标的", "标的及履约安排"),
    "BREACH": (r"违约", "违约责任"),
    "DISPUTE": (r"争议|管辖|仲裁", "争议解决"),
}
TYPE_DELIVERY = {
    "purchase": (r"规格|型号|数量|交付|供货", "货物规格、数量或交付安排"),
    "service": (r"服务范围|服务期限|服务内容|服务成果|服务标准|服务要求|验收", "服务范围、期限或成果验收安排"),
}
FIELD_LABELS = {
    "hospital_party": "院方主体", "counterparty": "相对方", "project_number": "项目编号",
    "amount": "金额", "amount_direction": "金额方向", "amount_fixed": "是否确定金额",
    "funding_source": "资金来源", "contract_type": "合同类型",
    "starts_on": "履行开始日期", "ends_on": "履行结束日期",
}
DATE_VALUE = r"([0-9]{4}(?:-[0-9]{1,2}-[0-9]{1,2}|年[0-9]{1,2}月[0-9]{1,2}日))(?![0-9])"
BODY_PATTERNS = {
    "starts_on": r"(?:履行开始(?:日期)?|履约开始日期|服务开始日期)[ \t]*[：:][ \t]*" + DATE_VALUE,
    "ends_on": r"(?:履行结束(?:日期)?|履约结束日期|服务结束日期)[ \t]*[：:][ \t]*" + DATE_VALUE,
    "hospital_party": r"(?:院方主体|甲方)[ \t]*[：:][ \t]*([^\n；;]+)",
    "amount_direction": r"(?:标的额情况|金额方向)[ \t]*[：:][ \t]*(收入|支出|不涉及金额)(?=[ \t]*(?:[；;]|\n|$))",
    "amount_fixed": r"是否确定金额[ \t]*[：:][ \t]*(是|否)(?=[ \t]*(?:[；;]|\n|$))",
    "funding_source": r"资金来源[ \t]*[：:][ \t]*([^\n；;]+)",
    "contract_type": r"合同类型[ \t]*[：:][ \t]*(业务合同|货物采购合同|服务合同)(?=[ \t]*(?:[；;]|\n|$))",
}
BODY_VALUES = {
    "amount_direction": {"收入": "income", "支出": "expense", "不涉及金额": "none"},
    "amount_fixed": {"是": "True", "否": "False"},
    "contract_type": {"业务合同": "business", "货物采购合同": "purchase", "服务合同": "service"},
}
AMOUNT_LABELS = {
    "contract": {"合同总金额", "合同金额", "合同总价"},
    "award": {"中标金额", "中标总价", "中标价"},
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def matches(key: str, first: str, second: str) -> bool:
    if key == "amount":
        return Decimal(first) == Decimal(second)
    first, second = normalize(first), normalize(second)
    if key == "project_number":
        first, second = first.rstrip("。."), second.rstrip("。.")
    return first == second


def extract_candidates(doc: dict, kind: str) -> dict[str, list[dict]]:
    """Keep every distinct explicit field value and its first verifiable location."""
    patterns = {"project_number": FIELD_PATTERNS["project_number"]}
    if kind == "contract":
        patterns.update(BODY_PATTERNS)
        patterns["counterparty"] = r"(?:合同相对方|相对方|乙方)[ \t]*[：:][ \t]*([^\n；;]+)"
    elif kind == "award":
        patterns["counterparty"] = FIELD_PATTERNS["counterparty"]

    candidates: dict[str, list[dict]] = {}

    def add(key, value, segment, match):
        value = value.strip()
        if key == "project_number":
            value = value.rstrip("。．.").rstrip()
            if not re.search(r"[0-9a-zA-Z]", unicodedata.normalize("NFKC", value)):
                return
        if not value or len(value) > 220:
            return
        if key in {"starts_on", "ends_on"}:
            try:
                value = date(*map(int, re.findall(r"[0-9]+", value))).isoformat()
            except ValueError:
                return
        value = BODY_VALUES.get(key, {}).get(value, value)
        items = candidates.setdefault(key, [])
        if not any(matches(key, value, item["value"]) for item in items):
            items.append({
                "value": value,
                "evidence": evidence(doc, segment, segment["start"] + match.start(), segment["start"] + match.end()),
            })

    for segment in doc["segments"]:
        text = doc["text"][segment["start"]:segment["end"]]
        for key, pattern in patterns.items():
            for match in re.finditer(pattern, text):
                add(key, match.group(1), segment, match)
        for match in AMOUNT_PATTERN.finditer(text):
            if match.group(1) not in AMOUNT_LABELS.get(kind, ()) or not match.group(3):
                continue
            if re.match(r"[ \t]*(?:[/／每]|起|以上|以下)", text[match.end():]):
                continue
            raw = match.group(2).replace("，", ",")
            if not re.fullmatch(r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,16})(?:\.[0-9]{1,6})?", raw):
                continue
            value = Decimal(raw.replace(",", ""))
            if match.group(3) == "万元":
                value *= 10_000
            add("amount", format(value, "f"), segment, match)
    return candidates


def finding(rule_id: str, level: str, kind: str, issue: str, suggestion: str, *, scope: str,
            citations=(), origin: str = "rule") -> dict:
    return {
        "id": str(uuid4()), "rule_id": rule_id, "rule_version": RULE_SET["version"],
        "origin": origin, "kind": kind, "level": level, "scope": scope,
        "issue": issue, "suggestion": suggestion, "evidence": list(citations),
        "reliability": "verifiable_quote" if citations else "no_quote",
    }


def run_rules(draft: ContractDraft, body: dict, materials: dict[str, dict]) -> tuple[list[dict], dict, dict]:
    findings = []
    coverage = {}
    elements = extract_candidates(body, "contract")

    def check(rule_id, level, kind, issue, suggestion, scope="contract", citations=()):
        findings.append(finding(rule_id, level, kind, issue, suggestion, scope=scope, citations=citations))

    required = {
        "contract_type": draft.contract_type, "hospital_party": draft.hospital_party,
        "counterparty": draft.counterparty, "amount_direction": draft.amount_direction,
        "funding_source": draft.funding_source,
    }
    if draft.amount_direction in {"income", "expense"}:
        required["amount_fixed"] = draft.amount_fixed
    fixed_amount = draft.amount_direction in {"income", "expense"} and draft.amount_fixed is True
    if fixed_amount:
        required["amount"] = draft.amount
    for key, value in required.items():
        if value is None or value == "":
            check(f"REQUIRED_{key.upper()}", "blocking", "missing", f"合同卡片缺少{FIELD_LABELS[key]}", "核对合同及业务表单后补充")
    if draft.amount_direction == "none" and draft.amount_fixed is not None:
        check("AMOUNT_MODE", "blocking", "conflict", "不涉及金额的合同填写了是否确定金额", "核对金额方向并清除不适用的确定金额选项")
    if draft.amount is not None and not requires_amount(draft):
        check("AMOUNT_MODE_VALUE", "blocking", "conflict", "金额条件与合同卡片中的固定金额冲突", "核对金额方向、是否确定金额和固定金额")
    if draft.hospital_party and draft.counterparty and matches("counterparty", draft.hospital_party, draft.counterparty):
        check("PARTIES_IDENTICAL", "blocking", "conflict", "合同卡片中的院方主体与相对方相同", "核实双方的完整法定名称")
    if not draft.procurement_reference:
        label = "前置审批编号" if draft.procurement_required else "无需招采的依据"
        check("PROCUREMENT_REFERENCE", "blocking", "missing", f"缺少{label}", "核对院内前置程序后补充", "procurement")
    if not draft.body or draft.body in {item["body"] for item in TEMPLATES.values()}:
        coverage["contract_text"] = "not_checked"
        check("BODY_REQUIRED", "blocking", "missing", "合同正文缺失或仍为起草模板", "上传或填写待审合同")
    else:
        coverage["contract_text"] = "partial" if body["status"] != "complete" else "complete"
        expected_in_text = ["hospital_party", "counterparty"]
        if fixed_amount:
            expected_in_text.append("amount")
        if draft.procurement_required:
            expected_in_text.append("project_number")
        for key in expected_in_text:
            if key not in elements:
                check(f"BODY_{key.upper()}", "warning", "insufficient", f"可读正文未识别到明确的{FIELD_LABELS[key]}",
                      "核对合同原件，确认该要素及其适用条款")
        for rule_id, (pattern, label) in CLAUSE_RULES.items():
            if rule_id == "PAYMENT" and draft.amount_direction == "none":
                continue
            if rule_id == "DELIVERY":
                pattern, label = TYPE_DELIVERY.get(draft.contract_type, (pattern, label))
            if not re.search(pattern, body["text"]):
                check(rule_id, "warning", "insufficient", f"可读正文未识别到{label}", "人工查阅完整原件并核对条款")

    for key, items in elements.items():
        target = getattr(draft, key)
        if len(items) > 1:
            check(f"TEXT_{key.upper()}", "warning", "conflict", f"正文存在多个{FIELD_LABELS[key]}候选值",
                  "核对上下文并确认适用的字段值", citations=[item["evidence"] for item in items[:5]])
        elif target is not None and target != "" and not matches(key, items[0]["value"], str(target)):
            check(f"CARD_{key.upper()}", "blocking", "conflict", f"正文{FIELD_LABELS[key]}与合同卡片不一致",
                  "核对引文及合同卡片，修订后重新预审", citations=[items[0]["evidence"]])
        if key == "amount" and draft.amount_direction == "none":
            check("NO_AMOUNT_TEXT", "warning", "conflict", "无金额合同正文出现明确的合同金额",
                  "人工确认该金额的性质及适用范围", citations=[item["evidence"] for item in items[:5]])

    contract_projects = elements.get("project_number", [])
    project_verified = bool(draft.project_number) and len(contract_projects) == 1 and matches(
        "project_number", contract_projects[0]["value"], draft.project_number,
    ) and coverage["contract_text"] == "complete" and body["reliability"] == "source"
    for kind, label in MATERIAL_LABELS.items():
        scope = f"procurement_{kind}"
        if not draft.procurement_required:
            coverage[scope] = "not_applicable"
            continue
        material = materials.get(kind)
        coverage[scope] = "not_checked"
        if not material or not material["text"] or material["reliability"] != "source":
            check(f"{kind.upper()}_SOURCE", "warning", "insufficient", f"{label}缺少可完整核对的已上传原文",
                  "上传同项目可读取文件，扫描件或人工摘录请线下核验", scope)
            continue
        fields = extract_candidates(material, kind)
        projects = fields.get("project_number", [])
        if not project_verified or len(projects) != 1:
            check(f"{kind.upper()}_PROJECT", "warning", "insufficient", f"{label}与合同的同项目关系未核实",
                  "对照合同正文、合同卡片及材料，确认明确且唯一的项目编号", scope,
                  [item["evidence"] for item in projects[:5]])
            continue
        if material["status"] != "complete":
            coverage[scope] = "partial"
            observed = "一致" if matches("project_number", projects[0]["value"], draft.project_number) else "不一致"
            check(f"{kind.upper()}_PARTIAL", "warning", "insufficient",
                  f"{label}可读部分的项目编号与合同{observed}，材料仍有未提取页",
                  "核查未提取页，再确认适用的材料和字段", scope,
                  [contract_projects[0]["evidence"], projects[0]["evidence"]])
            continue
        if not matches("project_number", projects[0]["value"], draft.project_number):
            coverage[scope] = "partial" if kind == "award" else "complete"
            check(f"{kind.upper()}_PROJECT", "blocking", "conflict", f"{label}与合同项目编号不一致",
                  "核对项目归属，使用同项目材料重新预审", scope,
                  [contract_projects[0]["evidence"], projects[0]["evidence"]])
            continue

        coverage[scope] = "complete"
        if kind != "award":
            continue
        for key in ("counterparty", "amount"):
            if key == "amount" and not requires_amount(draft):
                continue
            expected = elements.get(key, [])
            actual = fields.get(key, [])
            target = getattr(draft, key)
            if len(expected) != 1 or len(actual) != 1 or target is None or not matches(key, expected[0]["value"], str(target)):
                coverage[scope] = "partial"
                check(f"AWARD_{key.upper()}", "warning", "insufficient", f"中标{FIELD_LABELS[key]}未完成比对",
                      "核实合同正文、合同卡片及中标原文中的明确字段", scope,
                      [item["evidence"] for item in (*expected[:2], *actual[:2])])
            elif not matches(key, expected[0]["value"], actual[0]["value"]):
                check(f"AWARD_{key.upper()}", "blocking", "conflict", f"中标{FIELD_LABELS[key]}与合同不一致",
                      "核对同项目中标原文及合同的对应字段", scope,
                      [expected[0]["evidence"], actual[0]["evidence"]])
    return findings, coverage, elements
