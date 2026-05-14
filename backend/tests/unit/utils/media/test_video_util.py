from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace

import pytest

from utils.media import video_util
from utils.media.image_util import get_image_info
from utils.media.video_util import _parse_duration, get_video_info, generate_video_thumbnail

TEST_VIDEO_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'assets', 'kyo_cute_run.mp4'
)

@pytest.mark.unit
def test_get_video_info_reads_video_stream(monkeypatch) -> None:
    stdout = '{"streams": [{"codec_type": "video", "width": 1920, "height": 1080, "duration": "42.6"}]}'

    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=stdout, stderr='')

    import utils.media.video_util as video_util

    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)

    info = get_video_info('video.mp4')

    assert info.width == 1920
    assert info.height == 1080
    assert info.duration == pytest.approx(42.6)


@pytest.mark.unit
def test_parse_duration_falls_back_to_container_probe(monkeypatch) -> None:
    fallback_stdout = '{"format": {"duration": "10.25"}}'

    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=fallback_stdout, stderr='')

    import utils.media.video_util as video_util

    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)

    duration = _parse_duration({'codec_type': 'video'}, 'video.mp4')

    assert duration == pytest.approx(10.25)


@pytest.mark.unit
def test_parse_duration_fails(monkeypatch) -> None:
    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=0, stdout='{}', stderr='')
    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)

    with pytest.raises(ValueError):
        _parse_duration({'codec_type': 'video'}, 'video.mp4')


@pytest.mark.unit
def test_get_video_info_ffmpeg_fails(monkeypatch) -> None:
    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=1, stdout='', stderr='')
    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)

    with pytest.raises(RuntimeError):
        get_video_info('video.mp4')

@pytest.mark.unit
def test_get_video_info_no_stream(monkeypatch) -> None:
    stdout = '{"streams": [{"codec_type": "video", "width": 1920, "height": 1080, "duration": "42.6"}]}'
    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=stdout, stderr='')
    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)
    monkeypatch.setattr(video_util, '_first_stream', lambda _streams, _type: None)
    with pytest.raises(ValueError):
        get_video_info('video.mp4')

@pytest.mark.unit
def test_get_video_info_from_actual_video() -> None:
    info = get_video_info(TEST_VIDEO_PATH)
    assert info.width == 720
    assert info.height == 1280
    assert info.duration == pytest.approx(3.2, 0.1)


@pytest.mark.unit
def test_generate_video_thumbnail_for_actual_video() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        output_file = os.path.join(tmpdir, 'thumbnail.webp')

        generate_video_thumbnail(
            TEST_VIDEO_PATH,
            output_file,
        )

        thumbnail_info = get_image_info(output_file)
        assert thumbnail_info.width == 270
        assert thumbnail_info.height == 480


@pytest.mark.unit
def test_generate_video_thumbnail_ffmpeg_fails(monkeypatch) -> None:
    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=1, stdout='', stderr='')
    monkeypatch.setattr(video_util.subprocess, 'run', fake_run)
    with pytest.raises(RuntimeError):
        generate_video_thumbnail(
            'video.mp4',
            'thumbnail.webp',
        )
