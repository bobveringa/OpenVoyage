from __future__ import annotations

import logging
import threading
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.database.base import utcnow
from models.database.jobs import JobExecution, JobExecutionStatus

from .definitions import JOB_DEFINITIONS_BY_KEY

logger = logging.getLogger(__name__)


class JobRunner:
    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_loop, name='job-runner', daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def stop(self) -> None:
        self._stopping.set()
        self._wake.set()
        if self._thread:
            self._thread.join()

    def _run_loop(self) -> None:
        while not self._stopping.is_set():
            self._wake.wait(timeout=5)
            self._wake.clear()
            while not self._stopping.is_set() and self._run_next():
                pass

    def _run_next(self) -> bool:
        with self._session_factory() as db:
            execution = db.scalar(
                select(JobExecution)
                .where(JobExecution.status == JobExecutionStatus.QUEUED)
                .order_by(JobExecution.created_at, JobExecution.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if execution is None:
                return False
            execution.status = JobExecutionStatus.RUNNING
            execution.started_at = utcnow()
            execution_id = execution.id
            job_key = execution.job_key
            db.commit()

        started = utcnow()
        try:
            definition = JOB_DEFINITIONS_BY_KEY[job_key]
            with self._session_factory() as db:
                summary = definition.job_type(db).run().summary
            self._finish(execution_id, JobExecutionStatus.SUCCEEDED, summary=summary)
            logger.info('job_succeeded', extra={'job_key': job_key, 'execution_id': str(execution_id), 'duration_seconds': (utcnow() - started).total_seconds()})
        except Exception:
            logger.exception('job_failed', extra={'job_key': job_key, 'execution_id': str(execution_id)})
            self._finish(execution_id, JobExecutionStatus.FAILED, error_message='Job execution failed')
        return True

    def _finish(self, execution_id, status: JobExecutionStatus, *, summary: dict | None = None, error_message: str | None = None) -> None:
        with self._session_factory() as db:
            execution = db.get(JobExecution, execution_id)
            if execution is None:
                return
            execution.status = status
            execution.summary = summary
            execution.error_message = error_message
            execution.finished_at = utcnow()
            db.commit()
