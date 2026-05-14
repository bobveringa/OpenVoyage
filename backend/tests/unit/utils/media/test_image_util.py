import os.path
from tempfile import TemporaryDirectory

import pytest

from utils.media.image_util import get_image_info, ImageInfo, generate_image_thumbnail

TEST_IMAGE_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'assets', 'kyo_cute.jpg'
)


@pytest.mark.unit
def test_get_image_info():
    image_info = get_image_info(TEST_IMAGE_PATH)
    assert isinstance(image_info, ImageInfo)
    assert isinstance(image_info.width, int)
    assert isinstance(image_info.height, int)

    assert image_info.width == 1440
    assert image_info.height == 1913


@pytest.mark.unit
def test_generate_image_thumbnail():
    with TemporaryDirectory() as tmpdir:
        tmp_path = os.path.join(tmpdir, 'kyo_cute_thumbnail.webp')

        generate_image_thumbnail(
            TEST_IMAGE_PATH,
            tmp_path,
        )
        assert os.path.exists(tmp_path)

        thumbnail_info = get_image_info(tmp_path)
        assert thumbnail_info.width == 361
        assert thumbnail_info.height == 480
