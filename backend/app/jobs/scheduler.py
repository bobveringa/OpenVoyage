from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from models.database.jobs import ScheduledJob

logger = logging.getLogger(__name__)


class JobScheduler:
    """In-memory cron trigger manager; callbacks only enqueue durable work."""

    def __init__(self, enqueue_scheduled: Callable[[str], None]) -> None:
        self._scheduler = BackgroundScheduler(timezone=timezone.utc)
        self._enqueue_scheduled = enqueue_scheduled

    def start(self) -> None:
        self._scheduler.start()

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def apply(self, job: ScheduledJob, trigger: CronTrigger | None = None) -> None:
        job_id = f'openvoyage:{job.key}'
        if not job.enabled:
            if self._scheduler.get_job(job_id):
                self._scheduler.remove_job(job_id)
            return
        cron_trigger = trigger or CronTrigger.from_crontab(job.cron, timezone=job.timezone)
        self._scheduler.add_job(
            self._callback,
            trigger=cron_trigger,
            id=job_id,
            args=(job.key,),
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=60,
        )

    def remove(self, job_key: str) -> None:
        job_id = f'openvoyage:{job_key}'
        if self._scheduler.get_job(job_id):
            self._scheduler.remove_job(job_id)

    def next_run_at(self, job_key: str) -> datetime | None:
        job = self._scheduler.get_job(f'openvoyage:{job_key}')
        if job is None or job.next_run_time is None:
            return None
        return job.next_run_time.astimezone(timezone.utc)

    def _callback(self, job_key: str) -> None:
        try:
            self._enqueue_scheduled(job_key)
        except Exception:
            logger.exception('scheduled_job_enqueue_failed', extra={'job_key': job_key})
