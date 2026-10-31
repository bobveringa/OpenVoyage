from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from semver import Version
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.version import APP_VERSION
from models.api.software_updates import SoftwareReleaseResponse, SoftwareUpdateResponse
from models.database.base import utcnow
from models.database.jobs import JobExecution, JobExecutionStatus, ScheduledJob
from models.database.software_updates import SoftwareReleaseCache

UPDATE_JOB_KEY = 'software_update_check'
CHECK_INTERVAL = timedelta(hours=12)
CHECK_COOLDOWN = timedelta(minutes=5)
GITHUB_RELEASE_URL = 'https://api.github.com/repos/bobveringa/OpenVoyage/releases/latest'
MAX_RESPONSE_BYTES = 256 * 1024


class UpdateCheckError(RuntimeError):
    def __init__(self, code: str, retry_at: datetime | None = None):
        self.code = code
        self.retry_at = retry_at
        super().__init__(code)


@dataclass(frozen=True)
class ReleaseLookup:
    release: SoftwareReleaseResponse | None = None
    etag: str | None = None
    not_modified: bool = False


def compare_versions(installed: str, latest: str | None) -> str:
    if latest is None:
        return 'unknown'
    try:
        comparison = Version.parse(installed).compare(Version.parse(latest))
    except ValueError, TypeError:
        return 'unknown'
    return 'ahead' if comparison > 0 else 'update_available' if comparison < 0 else 'up_to_date'


def fetch_latest_release(etag: str | None = None) -> ReleaseLookup:
    headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': f'OpenVoyage/{APP_VERSION}',
        'X-GitHub-Api-Version': '2026-03-10',
    }
    if etag:
        headers['If-None-Match'] = etag
    try:
        with urlopen(Request(GITHUB_RELEASE_URL, headers=headers), timeout=5) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            response_etag = response.headers.get('ETag')
    except HTTPError as exc:
        try:
            if exc.code == 304:
                if not etag:
                    raise UpdateCheckError('invalid_response') from None
                return ReleaseLookup(not_modified=True, etag=etag)
            if exc.code == 404:
                return ReleaseLookup()
            if exc.code in (403, 429):
                retry_at = None
                try:
                    delay = exc.headers.get('Retry-After')
                    reset = exc.headers.get('X-RateLimit-Reset')
                    if delay:
                        retry_at = utcnow() + timedelta(seconds=max(0, min(int(delay), 86400)))
                    elif reset and exc.headers.get('X-RateLimit-Remaining') == '0':
                        retry_at = min(datetime.fromtimestamp(int(reset), timezone.utc), utcnow() + timedelta(days=1))
                except ValueError, OverflowError, OSError:
                    pass
                raise UpdateCheckError('rate_limited', retry_at) from None
            raise UpdateCheckError('github_unavailable') from None
        finally:
            exc.close()
    except TimeoutError:
        raise UpdateCheckError('timeout') from None
    except URLError as exc:
        raise UpdateCheckError('timeout' if isinstance(exc.reason, TimeoutError) else 'github_unavailable') from None
    except OSError, HTTPException:
        raise UpdateCheckError('github_unavailable') from None

    try:
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError('Response too large')
        data = json.loads(body)
        version = Version.parse(data['tag_name'].removeprefix('v'))
        url = data['html_url']
        parsed = urlparse(url)
        published = datetime.fromisoformat(data['published_at'].replace('Z', '+00:00'))
        if (
            data.get('draft') is not False or data.get('prerelease') is not False
            or version.prerelease is not None or len(str(version)) > 100
            or parsed.scheme != 'https' or parsed.netloc != 'github.com'
            or not parsed.path.lower().startswith('/bobveringa/openvoyage/releases/tag/')
            or len(url) > 2048 or published.tzinfo is None
        ):
            raise ValueError('Invalid stable release')
        release = SoftwareReleaseResponse(version=str(version), url=url, published_at=published)
        return ReleaseLookup(release, response_etag if response_etag and len(response_etag) <= 512 else None)
    except ValueError, KeyError, TypeError, AttributeError:
        raise UpdateCheckError('invalid_response') from None


class SoftwareUpdateService:
    def __init__(self, db: Session):
        self.db = db

    def _last_attempt(self, *, completed: bool = False) -> JobExecution | None:
        statuses = [JobExecutionStatus.SUCCEEDED, JobExecutionStatus.FAILED]
        if not completed:
            statuses.append(JobExecutionStatus.RUNNING)
        return self.db.scalar(select(JobExecution).where(
            JobExecution.job_key == UPDATE_JOB_KEY,
            JobExecution.status.in_(statuses),
            JobExecution.started_at.is_not(None),
        ).order_by(JobExecution.started_at.desc(), JobExecution.id.desc()).limit(1))

    def _failure_count(self) -> int:
        cache = self.db.get(SoftwareReleaseCache, 'stable')
        query = select(func.count()).select_from(JobExecution).where(
            JobExecution.job_key == UPDATE_JOB_KEY,
            JobExecution.status == JobExecutionStatus.FAILED,
            JobExecution.started_at.is_not(None),
        )
        if cache:
            query = query.where(JobExecution.started_at > cache.verified_at)
        return self.db.scalar(query) or 0

    def next_allowed_check(self) -> datetime | None:
        last = self._last_attempt(completed=True)
        if last is None:
            return None
        retry_at = last.started_at + CHECK_COOLDOWN
        if last.status == JobExecutionStatus.FAILED:
            retry_at = max(retry_at, last.started_at + timedelta(
                minutes=min(720, 5 * 2 ** min(max(0, self._failure_count() - 1), 8)),
            ))
            stored_retry = (last.summary or {}).get('retry_at')
            if isinstance(stored_retry, str):
                try:
                    parsed = datetime.fromisoformat(stored_retry)
                    if parsed.tzinfo is not None:
                        retry_at = max(retry_at, parsed)
                except ValueError:
                    pass
        return retry_at

    def should_check_on_start(self) -> bool:
        cache = self.db.get(SoftwareReleaseCache, 'stable')
        now = utcnow()
        retry_at = self.next_allowed_check()
        return (
            (cache is None or now - cache.verified_at >= CHECK_INTERVAL)
            and (retry_at is None or retry_at <= now)
        )

    def status(self) -> SoftwareUpdateResponse:
        cache = self.db.get(SoftwareReleaseCache, 'stable')
        job = self.db.get(ScheduledJob, UPDATE_JOB_KEY)
        enabled = job.enabled if job else True
        active = self.db.scalar(select(JobExecution.id).where(
            JobExecution.job_key == UPDATE_JOB_KEY,
            JobExecution.status.in_((JobExecutionStatus.QUEUED, JobExecutionStatus.RUNNING)),
        ).limit(1))
        last = self._last_attempt(completed=True)
        failed = bool(last and last.status == JobExecutionStatus.FAILED and (
            cache is None or last.started_at > cache.verified_at
        ))
        error = ((last.summary or {}).get('error_code') or 'check_failed') if failed else None
        check_status = (
            'checking' if active else 'disabled' if not enabled else 'failed' if failed
            else 'ok' if cache else 'never_checked'
        )
        release = None
        if cache and cache.version and cache.release_url and cache.published_at:
            release = SoftwareReleaseResponse(
                version=cache.version, url=cache.release_url, published_at=cache.published_at,
            )
        attempt = self._last_attempt()
        return SoftwareUpdateResponse(
            installed_version=APP_VERSION, latest_release=release,
            comparison=compare_versions(APP_VERSION, release.version if release else None),
            check_status=check_status, checks_enabled=enabled,
            last_attempt_at=attempt.started_at if attempt else None,
            last_success_at=cache.verified_at if cache else None,
            next_allowed_check_at=self.next_allowed_check(), error_code=error,
            is_stale=cache is None or utcnow() - cache.verified_at >= CHECK_INTERVAL,
        )

    def check(self) -> bool:
        now = utcnow()
        retry_at = self.next_allowed_check()
        if retry_at and retry_at > now:
            return False
        cache = self.db.get(SoftwareReleaseCache, 'stable')
        try:
            result = fetch_latest_release(cache.etag if cache else None)
        except UpdateCheckError as exc:
            backoff = timedelta(minutes=min(720, 5 * 2 ** min(self._failure_count(), 8)))
            exc.retry_at = max(now + backoff, exc.retry_at or now)
            raise
        if cache is None:
            cache = SoftwareReleaseCache(channel='stable')
            self.db.add(cache)
        if not result.not_modified:
            cache.version = result.release.version if result.release else None
            cache.release_url = result.release.url if result.release else None
            cache.published_at = result.release.published_at if result.release else None
        cache.etag = result.etag
        cache.verified_at = utcnow()
        self.db.commit()
        return True
