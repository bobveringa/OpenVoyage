from __future__ import annotations

from unittest.mock import Mock

import pytest


@pytest.fixture
def fake_db() -> Mock:
    db = Mock()
    db.get.return_value = None
    return db


@pytest.fixture
def fake_background_tasks() -> Mock:
    tasks = Mock()
    tasks.add_task = Mock()
    return tasks
