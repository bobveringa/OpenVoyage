from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import delete, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core import security
from factories.users import create_user
from models.api.software_updates import SoftwareReleaseResponse
from models.database.base import utcnow
from models.database.jobs import JobExecution, JobExecutionStatus, JobExecutionTrigger
from models.database.software_updates import SoftwareReleaseCache
from models.database.user import UserRole
from jobs.runner import JobRunner
from services.job_service import JobService
from services import software_update_service as updates


def auth(db, role=UserRole.ADMIN, **kwargs):
    user = create_user(db, role=role, **kwargs)
    tokens = security.create_auth_tokens(subject=user.id, email=user.email, auth_version=user.auth_version)
    return {'Authorization': f'Bearer {tokens["access_token"]}'}


def clear_update_runs(db):
    db.execute(delete(JobExecution).where(JobExecution.job_key == updates.UPDATE_JOB_KEY))
    db.commit()


def successful_lookup():
    return updates.ReleaseLookup(SoftwareReleaseResponse(
        version='99.0.0', url='https://github.com/bobveringa/OpenVoyage/releases/tag/v99.0.0',
        published_at=utcnow(),
    ), '"release"')


def test_release_cache_schema_and_constraints(db_session):
    columns = inspect(db_session.get_bind()).get_columns('software_release_cache')
    assert {column['name'] for column in columns} == {
        'channel', 'version', 'release_url', 'published_at', 'etag', 'verified_at',
    }
    for values in ({'channel': ''}, {'channel': 'stable', 'version': '0.5.0'}):
        with pytest.raises(IntegrityError), db_session.begin_nested():
            db_session.add(SoftwareReleaseCache(**values, verified_at=utcnow()))
            db_session.flush()


def run_check(db):
    # API startup also queues dataset imports; this helper runs only the update job.
    db.execute(delete(JobExecution).where(
        JobExecution.job_key != updates.UPDATE_JOB_KEY,
        JobExecution.status == JobExecutionStatus.QUEUED,
    ))
    db.commit()
    jobs = JobService(db)
    jobs.bootstrap()
    execution = jobs.enqueue(updates.UPDATE_JOB_KEY, trigger=JobExecutionTrigger.MANUAL)
    runner = JobRunner(lambda: Session(db.get_bind()))
    assert runner._run_next()
    db.expire_all()
    return db.get(JobExecution, execution.id)


def allow_next_check(db, execution):
    execution.started_at = utcnow() - timedelta(minutes=6)
    if execution.summary and 'retry_at' in execution.summary:
        execution.summary = {**execution.summary, 'retry_at': execution.started_at.isoformat()}
    db.commit()


def test_success_and_failure_preserve_verified_result(db_session, monkeypatch):
    fetch = MagicMock(return_value=successful_lookup())
    monkeypatch.setattr(updates, 'fetch_latest_release', fetch)
    service = updates.SoftwareUpdateService(db_session)
    assert service.status().check_status == 'never_checked'
    execution = run_check(db_session)
    assert execution.status == JobExecutionStatus.SUCCEEDED
    cache = db_session.get(SoftwareReleaseCache, 'stable')
    verified = cache.verified_at
    assert service.status().comparison == 'update_available'
    assert not service.check()
    fetch.assert_called_once_with(None)
    allow_next_check(db_session, execution)
    fetch.side_effect = updates.UpdateCheckError('timeout')
    execution = run_check(db_session)
    assert execution.status == JobExecutionStatus.FAILED
    assert execution.summary['error_code'] == 'timeout'
    assert execution.summary['retry_at']
    status = service.status()
    assert cache.verified_at == verified
    assert status.last_success_at == verified
    assert status.last_attempt_at == execution.started_at
    assert status.latest_release.version == '99.0.0'
    assert status.check_status == 'failed'
    assert status.comparison == 'update_available'
    assert status.error_code == 'timeout'


def test_failed_checks_leave_no_cache_and_back_off(db_session, monkeypatch):
    fetch = MagicMock(side_effect=updates.UpdateCheckError('timeout'))
    monkeypatch.setattr(updates, 'fetch_latest_release', fetch)
    first = run_check(db_session)
    service = updates.SoftwareUpdateService(db_session)
    assert db_session.get(SoftwareReleaseCache, 'stable') is None
    assert service.status().check_status == 'failed'
    assert service.next_allowed_check() >= first.started_at + timedelta(minutes=5)
    allow_next_check(db_session, first)
    second = run_check(db_session)
    assert second.status == JobExecutionStatus.FAILED
    assert service.next_allowed_check() >= second.started_at + timedelta(minutes=10)
    assert db_session.get(SoftwareReleaseCache, 'stable') is None


def test_cached_read_and_not_modified_do_not_lose_release(db_session, monkeypatch):
    monkeypatch.setattr(updates, 'fetch_latest_release', MagicMock(return_value=successful_lookup()))
    execution = run_check(db_session)
    allow_next_check(db_session, execution)
    cache = db_session.get(SoftwareReleaseCache, 'stable')
    cache.verified_at = utcnow() - timedelta(days=1)
    db_session.commit()
    service = updates.SoftwareUpdateService(db_session)
    fetch = MagicMock(return_value=updates.ReleaseLookup(not_modified=True, etag='"release"'))
    monkeypatch.setattr(updates, 'fetch_latest_release', fetch)
    assert service.status().is_stale
    fetch.assert_not_called()
    run_check(db_session)
    fetch.assert_called_once_with('"release"')
    assert service.status().latest_release.version == '99.0.0'
    assert not service.status().is_stale


def test_no_published_release_clears_previous_release(db_session, monkeypatch):
    fetch = MagicMock(return_value=successful_lookup())
    monkeypatch.setattr(updates, 'fetch_latest_release', fetch)
    execution = run_check(db_session)
    allow_next_check(db_session, execution)
    fetch.return_value = updates.ReleaseLookup()
    run_check(db_session)
    status = updates.SoftwareUpdateService(db_session).status()
    assert status.check_status == 'ok'
    assert status.comparison == 'unknown'
    assert status.latest_release is None
    cache = db_session.get(SoftwareReleaseCache, 'stable')
    assert (cache.version, cache.release_url, cache.published_at, cache.etag) == (None,) * 4
    assert cache.verified_at is not None


@pytest.mark.parametrize('role', [UserRole.USER, UserRole.COMPANION])
def test_regular_users_cannot_read_or_trigger_checks(client, db_session, api_prefix, role):
    headers = auth(db_session, role)
    assert client.get(f'{api_prefix}/admin/updates', headers=headers).status_code == 403
    assert client.post(f'{api_prefix}/admin/jobs/{updates.UPDATE_JOB_KEY}/executions', headers=headers).status_code == 403


def test_anonymous_and_assigned_password_users_cannot_access_checks(client, db_session, api_prefix):
    assert client.get(f'{api_prefix}/admin/updates').status_code == 401
    assert client.post(f'{api_prefix}/admin/jobs/{updates.UPDATE_JOB_KEY}/executions').status_code == 401
    headers = auth(db_session, password_change_required=True)
    assert client.get(f'{api_prefix}/admin/updates', headers=headers).status_code == 403
    assert client.post(f'{api_prefix}/admin/jobs/{updates.UPDATE_JOB_KEY}/executions', headers=headers).status_code == 403


def test_admin_reads_cache_and_manual_checks_deduplicate_and_cool_down(client, db_session, api_prefix, monkeypatch):
    headers = auth(db_session)
    clear_update_runs(db_session)
    fetch = MagicMock(return_value=successful_lookup())
    monkeypatch.setattr(updates, 'fetch_latest_release', fetch)
    response = client.get(f'{api_prefix}/admin/updates', headers=headers)
    assert response.status_code == 200
    assert response.json()['check_status'] == 'never_checked'
    assert response.headers['cache-control'] == 'private, no-store'
    fetch.assert_not_called()
    url = f'{api_prefix}/admin/jobs/{updates.UPDATE_JOB_KEY}/executions'
    assert client.post(url, headers=headers).status_code == 202
    assert client.post(url, headers=headers).status_code == 409
    assert client.get(f'{api_prefix}/admin/updates', headers=headers).json()['check_status'] == 'checking'
    clear_update_runs(db_session)
    run_check(db_session)
    response = client.post(url, headers=headers)
    assert response.status_code == 429
    assert int(response.headers['retry-after']) > 0
    assert client.get(f'{api_prefix}/admin/updates', headers=headers).json()['comparison'] == 'update_available'


def test_startup_checks_stale_cache_and_respects_disabled_schedule(db_session, monkeypatch):
    jobs = JobService(db_session)
    jobs.bootstrap()
    monkeypatch.setattr(updates, 'fetch_latest_release', MagicMock(return_value=successful_lookup()))
    service = updates.SoftwareUpdateService(db_session)
    execution = run_check(db_session)
    jobs.enqueue_startup_jobs()
    assert service.status().check_status == 'ok'
    cache = db_session.get(SoftwareReleaseCache, 'stable')
    cache.verified_at = utcnow() - timedelta(hours=13)
    allow_next_check(db_session, execution)
    jobs.enqueue_startup_jobs()
    assert service.status().check_status == 'checking'
    clear_update_runs(db_session)
    jobs.update(updates.UPDATE_JOB_KEY, enabled=False, updated_by=None)
    jobs.enqueue_startup_jobs()
    assert service.status().check_status == 'disabled'
    assert jobs.enqueue(updates.UPDATE_JOB_KEY, trigger=JobExecutionTrigger.MANUAL).status == JobExecutionStatus.QUEUED
