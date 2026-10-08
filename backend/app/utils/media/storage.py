"""Private staging and process-local activity tracking for media work."""

import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from core.config import settings

_active: set[uuid.UUID] = set()
_lock = threading.RLock()


def storage_prefix(media_id: uuid.UUID) -> Path:
    return Path(settings.media_root) / media_id.hex[:2] / media_id.hex[2:4] / str(media_id)


def staging_root() -> Path:
    return Path(settings.media_root) / '.staging'


def staging_directory(media_id: uuid.UUID) -> Path:
    return staging_root() / str(media_id)


def register_active(media_id: uuid.UUID) -> None:
    with _lock:
        _active.add(media_id)


def unregister_active(media_id: uuid.UUID) -> None:
    with _lock:
        _active.discard(media_id)


def is_active(media_id: uuid.UUID) -> bool:
    with _lock:
        return media_id in _active


def remove_staging(media_id: uuid.UUID) -> None:
    directory = staging_directory(media_id)
    root = staging_root().resolve()
    if (not root.is_relative_to(Path(settings.media_root).resolve())
            or not directory.resolve().is_relative_to(root) or directory.is_symlink()):
        raise ValueError('Staging path is outside staging root')
    if directory.exists():
        shutil.rmtree(directory)


def remove_promoted(media_id: uuid.UUID) -> int:
    prefix = storage_prefix(media_id)
    removed = 0
    for path in prefix.parent.glob(prefix.name + '.*'):
        remove_stored_file(path)
        removed += 1
    return removed


def remove_stored_file(path: str | Path) -> None:
    path = Path(path)
    root = Path(settings.media_root).resolve()
    if path.resolve() == root or not path.resolve().is_relative_to(root):
        raise ValueError('Media path is outside media root')
    path.unlink(missing_ok=True)


def cleanup_staging(*, cutoff: datetime | None = None) -> int:
    """Scan files without requiring a media row; never race active work."""
    root = staging_root()
    if not root.exists():
        return 0
    removed = 0
    with _lock:
        for directory in root.iterdir():
            media_id = uuid.UUID(directory.name)
            if media_id in _active:
                continue
            if cutoff is not None and directory.stat().st_mtime >= cutoff.timestamp():
                continue
            removed += sum(1 for path in directory.rglob('*') if path.is_file())
            remove_staging(media_id)
    return removed
