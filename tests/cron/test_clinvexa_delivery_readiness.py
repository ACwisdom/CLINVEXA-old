"""Delivery-readiness coverage for CLINVEXA scheduled tasks.

The test creates eight real cron records in an isolated HERMES_HOME and runs
their script-only execution path.  No user jobs, sessions, or provider quota
are touched.
"""

from __future__ import annotations

import importlib

import pytest


TEST_TASKS = (
    ("门诊开诊前检查", "every 5m"),
    ("候诊队列巡检", "every 15m"),
    ("随访任务汇总", "every 30m"),
    ("科室运行状态", "every 1h"),
    ("工作日晨间清单", "0 9 * * 1-5"),
    ("每日收诊核对", "0 18 * * *"),
    ("每周随访提醒", "0 8 * * 1"),
    ("每月质控汇总", "0 9 1 * *"),
)


@pytest.fixture
def delivery_home(tmp_path, monkeypatch):
    """Give the readiness run a clean scheduler store and scripts sandbox."""
    home = tmp_path / ".hermes"
    (home / "cron" / "output").mkdir(parents=True)
    (home / "scripts").mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))

    import hermes_constants
    import cron.jobs
    import cron.scheduler

    importlib.reload(hermes_constants)
    importlib.reload(cron.jobs)
    importlib.reload(cron.scheduler)
    return home


def test_eight_tasks_complete_crud_and_execution_lifecycle(delivery_home):
    from cron.jobs import (
        create_job,
        get_due_jobs,
        get_job,
        list_jobs,
        mark_job_run,
        pause_job,
        remove_job,
        resume_job,
        trigger_job,
        update_job,
    )
    from cron.scheduler import run_job

    created = []
    for index, (name, schedule) in enumerate(TEST_TASKS, start=1):
        script_name = f"clinvexa-readiness-{index}.py"
        expected = f"CLINVEXA_CRON_OK:{index}:{name}"
        (delivery_home / "scripts" / script_name).write_text(
            f"print({expected!r})\n",
            encoding="utf-8",
        )
        created.append(
            (
                create_job(
                    prompt="",
                    schedule=schedule,
                    name=name,
                    script=script_name,
                    no_agent=True,
                    deliver="local",
                ),
                expected,
            )
        )

    stored = list_jobs(include_disabled=True)
    assert {job["id"] for job, _ in created} == {job["id"] for job in stored}
    assert len(stored) == len(TEST_TASKS)

    for job, expected in created:
        success, document, final_response, error = run_job(job)
        assert success is True
        assert error is None
        assert expected in document
        assert expected in final_response

        mark_job_run(job["id"], success=True)
        persisted = get_job(job["id"])
        assert persisted is not None
        assert persisted["last_status"] == "ok"
        assert persisted["repeat"]["completed"] == 1
        assert persisted["next_run_at"] is not None

    lifecycle_job = created[0][0]
    paused = pause_job(lifecycle_job["id"], reason="readiness test")
    assert paused is not None
    assert paused["enabled"] is False
    assert paused["state"] == "paused"

    resumed = resume_job(lifecycle_job["id"])
    assert resumed is not None
    assert resumed["enabled"] is True
    assert resumed["state"] == "scheduled"

    triggered = trigger_job(lifecycle_job["id"])
    assert triggered is not None
    assert lifecycle_job["id"] in {job["id"] for job in get_due_jobs()}

    renamed = update_job(lifecycle_job["id"], {"name": "门诊开诊前检查（已验证）"})
    assert renamed is not None
    assert renamed["name"] == "门诊开诊前检查（已验证）"

    for job, _ in created:
        assert remove_job(job["id"]) is True
    assert list_jobs(include_disabled=True) == []
