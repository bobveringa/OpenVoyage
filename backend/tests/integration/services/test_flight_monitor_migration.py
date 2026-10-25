from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select

from factories.users import create_user
from integration.api.test_tracking import _auth_headers
from models.database.jobs import JobExecution, ScheduledJob
from models.database.user import UserRole
from services.app_settings_service import AppSettingsService


def alembic_config(engine):
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'app/alembic'))
    config.set_main_option(
        'sqlalchemy.url', engine.url.render_as_string(hide_password=False)
    )
    return config


@pytest.mark.parametrize('enabled', [False, True, None])
@pytest.mark.parametrize('active_status', ['QUEUED', 'RUNNING'])
def test_migration_preserves_controls_provider_and_history(
    engine, db_session, enabled, active_status
):
    db = db_session
    config = alembic_config(engine)
    command.downgrade(config, 'a4c6e8f01235')
    AppSettingsService(db).update_setting('flights.provider', 'flightaware', None)
    history_ids = []
    if enabled is not None:
        db.add(
            ScheduledJob(
                key='flight_tracking',
                enabled=enabled,
                cron='0 12 * * *',
                timezone='Europe/Amsterdam',
            )
        )
        db.flush()
        for status in (active_status, 'SUCCEEDED'):
            execution = JobExecution(
                job_key='flight_tracking',
                trigger='MANUAL',
                status=status,
                summary={'preserved': True},
            )
            db.add(execution)
            db.flush()
            history_ids.append(execution.id)
        db.commit()
    before = db.get(ScheduledJob, 'flight_tracking')
    audit = (
        (before.created_at, before.updated_at, before.updated_by) if before else None
    )
    db.commit()
    command.upgrade(config, 'head')
    db.expire_all()
    assert AppSettingsService(db).get_value('flights.provider') == 'flightaware'
    if enabled is None:
        assert db.get(ScheduledJob, 'flight_tracking') is None
    else:
        job = db.get(ScheduledJob, 'flight_tracking')
        assert (job.enabled, job.cron, job.timezone) == (
            enabled,
            '0 12 * * *',
            'Europe/Amsterdam',
        )
        assert (job.created_at, job.updated_at, job.updated_by) == audit
        active = db.get(JobExecution, history_ids[0])
        assert active.status == 'FAILED'
        assert active.finished_at is not None
        assert 'dedicated flight monitor' in active.error_message
        assert active.summary == {'preserved': True}
        history = db.get(JobExecution, history_ids[1])
        assert history.status == 'SUCCEEDED'
        assert history.finished_at is None
    db.commit()
    command.downgrade(config, 'a4c6e8f01235')
    db.expire_all()
    if enabled is not None:
        job = db.get(ScheduledJob, 'flight_tracking')
        assert (job.enabled, job.cron, job.timezone) == (
            enabled,
            '0 12 * * *',
            'Europe/Amsterdam',
        )
        assert db.get(JobExecution, history_ids[0]).status == 'FAILED'
    else:
        assert db.get(ScheduledJob, 'flight_tracking') is None


def test_retired_job_controls_return_404_and_history_remains_readable(
    client, db_session, api_prefix
):
    db = db_session
    admin = create_user(db, role=UserRole.ADMIN)
    headers = _auth_headers(admin)
    db.add(
        ScheduledJob(
            key='flight_tracking', enabled=False, cron='0 12 * * *', timezone='UTC'
        )
    )
    db.flush()
    execution = JobExecution(
        job_key='flight_tracking', trigger='MANUAL', status='SUCCEEDED'
    )
    db.add(execution)
    db.commit()
    base = f'{api_prefix}/admin'
    listing = client.get(f'{base}/jobs', headers=headers)
    assert listing.status_code == 200
    assert 'flight_tracking' not in {job['key'] for job in listing.json()['jobs']}
    for method, suffix, body in (
        ('GET', '', None),
        ('PATCH', '', {'enabled': True}),
        ('POST', '/reset', None),
        ('POST', '/executions', None),
    ):
        response = client.request(
            method, f'{base}/jobs/flight_tracking{suffix}', headers=headers, json=body
        )
        assert response.status_code == 404
    history = client.get(
        f'{base}/job-executions?job_key=flight_tracking', headers=headers
    )
    assert history.status_code == 200
    assert history.json()['total'] == 1
    detail = client.get(f'{base}/job-executions/{execution.id}', headers=headers)
    assert detail.status_code == 200
    assert detail.json()['status'] == 'SUCCEEDED'
    assert (
        len(
            list(
                db.scalars(
                    select(JobExecution).where(
                        JobExecution.job_key == 'flight_tracking'
                    )
                )
            )
        )
        == 1
    )
