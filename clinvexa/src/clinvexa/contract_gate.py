"""Evaluate and record isolated contract submission rehearsals."""

from __future__ import annotations

import json
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from clinvexa.contract_review_store import ContractReviewStore, encoded, now
from clinvexa.contracts import ContractError, ContractRecord

GateReason = Literal[
    "not_reviewed", "high_risk_pending", "high_risk_confirmed", "needs_materials",
    "review_incomplete", "model_incomplete",
]


class GatePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    block: list[GateReason] = Field(default_factory=list)
    allow_exception: bool = False


class GateInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    revision: int = Field(ge=1)
    exception_reason: str = Field(default="", max_length=1000)


def load_gate_policy() -> GatePolicy:
    import yaml
    from hermes_cli.config import get_config_path

    try:
        config = yaml.safe_load(get_config_path().read_text(encoding="utf-8")) or {}
        return GatePolicy.model_validate(config.get("contract_preaudit", {}))
    except FileNotFoundError:
        return GatePolicy()
    except (AttributeError, OSError, ValueError, ValidationError, yaml.YAMLError) as exc:
        raise ContractError("预审演练策略配置无效", 503) from exc


def assessment(job: dict | None, policy: GatePolicy) -> dict:
    reasons = set()
    if job is None:
        reasons.update(("not_reviewed", "model_incomplete"))
    else:
        if job["status"] != "completed":
            reasons.add("review_incomplete")
        if job["coverage"].get("model") != "complete":
            reasons.add("model_incomplete")
        if any(state != "complete" and state != "not_applicable"
               for scope, state in job["coverage"].items() if scope.startswith("procurement_")):
            reasons.add("needs_materials")
        for finding in job["findings"]:
            history = job["decisions"].get(finding["id"], [])
            decision = history[-1]["status"] if history else "pending"
            if decision == "needs_evidence":
                reasons.add("needs_materials")
            if finding["level"] == "blocking" or any(
                candidate["level"] == "blocking" for candidate in finding.get("model_suggestions", [])
            ):
                if decision == "accepted":
                    reasons.add("high_risk_confirmed")
                elif decision in {"pending", "needs_evidence"}:
                    reasons.add("high_risk_pending")
    blocking = sorted(reasons.intersection(policy.block))
    return {
        "simulation": True, "allowed": not blocking, "reasons": sorted(reasons), "blocking": blocking,
        "job_id": job["id"] if job else None, "job_status": job["status"] if job else None,
        "decision_revision": job["decision_revision"] if job else None,
        "model_status": job["coverage"].get("model") if job else None,
    }


def rehearse(store: ContractReviewStore, record: ContractRecord, request: GateInput,
             *, policy: GatePolicy, operator: str, may_override: bool,
             followup_id: UUID | None = None) -> dict:
    contract_id = str(record.id)
    with store.connect(write=True) as db:
        current = db.execute("SELECT revision FROM contracts WHERE id = ?", (contract_id,)).fetchone()
        if current is None or current[0] != request.revision:
            raise ContractError("合同已被更新，请重新打开后再试")
        job = store.latest_for_revision(db, contract_id, request.revision)
        result = assessment(job, policy)
        existing = db.execute(
            "SELECT payload FROM contract_gate_exceptions WHERE contract_id = ? AND revision = ?",
            (contract_id, request.revision),
        ).fetchone()
        exception = json.loads(existing[0]) if existing else None
        if not request.exception_reason and followup_id is None:
            return {**result, "exception": exception} if may_override else result
        if not may_override:
            raise ContractError("当前工作区没有演练例外权限", 403)

        if followup_id:
            if not exception or exception["id"] != str(followup_id):
                raise ContractError("该合同版本的演练例外不存在", 404)
            if exception["state"] == "resolved":
                return {**result, "exception": exception}
            if (not job or job["status"] != "completed" or job["created_at"] <= exception["granted_at"]
                    or set(result["reasons"]).intersection(exception["policy_block"]) or result["blocking"]):
                raise ContractError("请先完成同一合同版本的新补审，并处理演练策略中的阻断项")
            exception.update(state="resolved", followup_job_id=job["id"],
                             followup_decision_revision=job["decision_revision"], resolved_at=now(),
                             resolved_by=operator)
            db.execute("UPDATE contract_gate_exceptions SET payload = ? WHERE id = ?",
                       (encoded(exception), exception["id"]))
            return {**result, "exception": exception}

        if not policy.allow_exception:
            raise ContractError("演练策略未启用例外放行", 403)
        if exception:
            if exception["state"] != "pending" or exception["reason"] != request.exception_reason:
                raise ContractError("该版本已有演练例外记录")
        elif result["blocking"]:
            exception = {
                "id": str(uuid4()), "contract_id": contract_id, "contract_revision": request.revision,
                "state": "pending", "reason": request.exception_reason, "granted_by": operator,
                "granted_at": now(), "policy_block": policy.block, "assessment": result,
            }
            db.execute("INSERT INTO contract_gate_exceptions VALUES (?, ?, ?, ?)",
                       (exception["id"], contract_id, request.revision, encoded(exception)))
        else:
            raise ContractError("当前演练准入无需例外")
        return {**result, "allowed": True, "exception": exception}
