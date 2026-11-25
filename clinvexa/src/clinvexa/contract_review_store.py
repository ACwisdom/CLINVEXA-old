"""SQLite storage for immutable review inputs, findings, decisions and reports."""

from __future__ import annotations

import json
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from clinvexa.contracts import ContractError, ContractStore

RUN_WINDOW = timedelta(seconds=120)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encoded(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False)


class ContractReviewStore:
    def __init__(self, contracts: ContractStore):
        self.contracts = contracts

    @contextmanager
    def connect(self, *, write: bool = False):
        with closing(self.contracts._connect()) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_review_documents "
                "(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, payload TEXT NOT NULL, data BLOB NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_review_jobs "
                "(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, payload TEXT NOT NULL)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS contract_review_history ON contract_review_jobs (contract_id)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_review_reports "
                "(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, payload TEXT NOT NULL)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS contract_review_report_history ON contract_review_reports (job_id)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS contract_gate_exceptions "
                "(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, "
                "UNIQUE (contract_id, revision))"
            )
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db

    def latest_for_revision(self, db, contract_id: str, revision: int) -> dict | None:
        rows = db.execute(
            "SELECT payload FROM contract_review_jobs WHERE contract_id = ? ORDER BY rowid DESC", (contract_id,),
        )
        for (payload,) in rows:
            job = json.loads(payload)
            if job["contract_revision"] == revision:
                return self._expire(db, job)
        return None

    def add_document(self, contract_id: str, document: dict, data: bytes) -> None:
        with self.connect(write=True) as db:
            db.execute("INSERT INTO contract_review_documents VALUES (?, ?, ?, ?)",
                       (document["id"], contract_id, encoded(document), data))

    def document(self, contract_id: str, document_id: str) -> dict:
        with self.connect() as db:
            row = db.execute(
                "SELECT payload FROM contract_review_documents WHERE id = ? AND contract_id = ?",
                (document_id, contract_id),
            ).fetchone()
        if row is None:
            raise ContractError("该合同的预审附件不存在", 404)
        return json.loads(row[0])

    def original(self, contract_id: str, document_id: str) -> bytes:
        with self.connect() as db:
            row = db.execute(
                "SELECT data FROM contract_review_documents WHERE id = ? AND contract_id = ?",
                (document_id, contract_id),
            ).fetchone()
        if row is None:
            raise ContractError("该合同的预审附件不存在", 404)
        return row[0]

    @staticmethod
    def _write_job(db, job: dict) -> None:
        db.execute("UPDATE contract_review_jobs SET payload = ? WHERE id = ? AND contract_id = ?",
                   (encoded(job), job["id"], job["contract_id"]))

    def _expire(self, db, job: dict) -> dict:
        if job["status"] == "running" and datetime.fromisoformat(job["created_at"]) + RUN_WINDOW < datetime.now(timezone.utc):
            job.update(
                status="partial" if job["coverage"]["rules"] == "complete" else "failed",
                error="任务运行中断或超过时限，可发起新任务",
                finished_at=now(),
            )
            if job["coverage"]["model"] == "running":
                job["coverage"]["model"] = "interrupted"
            if job["coverage"]["rules"] == "running":
                job["coverage"]["rules"] = "interrupted"
            self._write_job(db, job)
        return job

    def _get(self, db, contract_id: str, job_id: str) -> dict:
        row = db.execute(
            "SELECT payload FROM contract_review_jobs WHERE id = ? AND contract_id = ?",
            (job_id, contract_id),
        ).fetchone()
        if row is None:
            raise ContractError("预审任务不存在", 404)
        return self._expire(db, json.loads(row[0]))

    def get(self, contract_id: str, job_id: str) -> dict:
        with self.connect(write=True) as db:
            return self._get(db, contract_id, job_id)

    def start(self, job: dict) -> tuple[dict, bool]:
        with self.connect(write=True) as db:
            changed = db.execute(
                "INSERT OR IGNORE INTO contract_review_jobs VALUES (?, ?, ?)",
                (job["id"], job["contract_id"], encoded(job)),
            ).rowcount
            if changed:
                return job, True
            existing = self._get(db, job["contract_id"], job["id"])
            if existing["request"] != job["request"]:
                raise ContractError("任务编号已用于其他预审输入")
            return existing, False

    def update_running(self, job: dict) -> dict:
        with self.connect(write=True) as db:
            saved = self._get(db, job["contract_id"], job["id"])
            if saved["status"] != "running":
                return saved
            self._write_job(db, job)
        return job

    def history(self, contract_id: str) -> list[dict]:
        with self.connect(write=True) as db:
            rows = db.execute(
                "SELECT payload FROM contract_review_jobs WHERE contract_id = ? ORDER BY rowid DESC", (contract_id,),
            ).fetchall()
            jobs = [self._expire(db, json.loads(payload)) for (payload,) in rows]
            keys = ("id", "contract_revision", "status", "created_at", "finished_at", "coverage")
            return [{key: job[key] for key in keys} for job in jobs]

    def decide(self, contract_id: str, job_id: str, finding_id: str, revision: int, decision: dict) -> dict:
        with self.connect(write=True) as db:
            job = self._get(db, contract_id, job_id)
            if job["status"] not in {"completed", "partial"}:
                raise ContractError("仅可复核已结束任务的发现项")
            if not any(item["id"] == finding_id for item in job["findings"]):
                raise ContractError("预审发现不存在", 404)
            if job["decision_revision"] != revision:
                raise ContractError("人工复核已有更新，请重新打开任务")
            job["decisions"].setdefault(finding_id, []).append({**decision, "at": now()})
            job["decision_revision"] += 1
            self._write_job(db, job)
            return job

    def report(self, contract_id: str, job_id: str) -> dict:
        with self.connect(write=True) as db:
            job = self._get(db, contract_id, job_id)
            if job["status"] == "running":
                raise ContractError("任务仍在运行，请稍后生成报告")
            report = {
                "id": str(uuid4()), "generated_at": now(),
                **{key: job[key] for key in (
                    "contract_id", "contract_revision", "status", "coverage", "rules", "model",
                    "created_at", "finished_at", "findings", "decisions", "decision_revision", "error",
                )},
                "job_id": job_id,
                "contract": {key: value for key, value in job["draft"].items()
                             if key not in {"body", "materials", "preaudit_documents"}},
                "documents": [{key: value for key, value in doc.items() if key not in {"text", "segments"}}
                              for doc in job["documents"]],
                "input_sha256": job["input_sha256"],
            }
            db.execute("INSERT INTO contract_review_reports VALUES (?, ?, ?)",
                       (report["id"], job_id, encoded(report)))
            return report

    def reports(self, contract_id: str, job_id: str) -> list[dict]:
        with self.connect(write=True) as db:
            self._get(db, contract_id, job_id)
            rows = db.execute(
                "SELECT payload FROM contract_review_reports WHERE job_id = ? ORDER BY rowid DESC", (job_id,),
            ).fetchall()
        reports = [json.loads(payload) for (payload,) in rows]
        return [{key: report[key] for key in ("id", "generated_at", "decision_revision")} for report in reports]

    def read_report(self, contract_id: str, job_id: str, report_id: str) -> dict:
        with self.connect(write=True) as db:
            self._get(db, contract_id, job_id)
            row = db.execute(
                "SELECT payload FROM contract_review_reports WHERE id = ? AND job_id = ?",
                (report_id, job_id),
            ).fetchone()
        if row is None:
            raise ContractError("预审报告不存在", 404)
        return json.loads(row[0])
