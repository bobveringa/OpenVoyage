import runpy
import shutil
from pathlib import Path

import pytest

from core import version


@pytest.mark.parametrize('parent_metadata', [None, '{"version": "99.0.0"}'])
def test_version_module_runs_without_repository_metadata(tmp_path: Path, parent_metadata):
    standalone_module = tmp_path / 'backend' / 'app' / 'core' / 'version.py'
    standalone_module.parent.mkdir(parents=True)
    shutil.copyfile(version.__file__, standalone_module)
    if parent_metadata is not None:
        (tmp_path / 'package.json').write_text(parent_metadata, encoding='utf-8')

    metadata = runpy.run_path(str(standalone_module))

    assert metadata['APP_VERSION'] == version.APP_VERSION
