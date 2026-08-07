from __future__ import annotations

from sqlalchemy.orm import Session

from core.db import get_engine
from models.database.jobs import JobExecutionTrigger
from services.job_service import JobService

from .runner import JobRunner
from .scheduler import JobScheduler


class JobRuntime:
    """Lifespan-owned job scheduler and sequential durable queue worker."""

    def __init__(self) -> None:
        self.runner = JobRunner(lambda: Session(get_engine()))
        self.scheduler = JobScheduler(self.enqueue_scheduled)

    def start(self) -> None:
        with Session(get_engine()) as db:
            service = JobService(db, scheduler=self.scheduler, wake_runner=self.runner.wake)
            service.bootstrap()
            service.recover_interrupted()
        self.runner.start()
        self.scheduler.start()
        with Session(get_engine()) as db:
            service = JobService(db, scheduler=self.scheduler, wake_runner=self.runner.wake)
            for record in service.list_records():
                if record.schedule_error is None:
                    self.scheduler.apply(record.job)
            service.enqueue_startup_jobs()

    def stop(self) -> None:
        self.scheduler.shutdown()
        self.runner.stop()

    def enqueue_scheduled(self, job_key: str) -> None:
        with Session(get_engine()) as db:
            JobService(db, scheduler=self.scheduler, wake_runner=self.runner.wake).enqueue(
                job_key, trigger=JobExecutionTrigger.SCHEDULED
            )
