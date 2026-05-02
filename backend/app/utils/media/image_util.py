from dataclasses import dataclass

from PIL import Image


@dataclass
class ImageInfo:
    width: int
    height: int


def get_image_info(file: str) -> ImageInfo:
    image = Image.open(file)
    width, height = image.size
    return ImageInfo(width=width, height=height)


CONTENT_TYPE_TO_FORMAT = {
    'image/webp': 'WEBP',
    'image/jpeg': 'JPEG',
}


def generate_image_thumbnail(
    file_path: str,
    destination: str,
    max_size: tuple[int, int] = (480, 480),
    quality: int = 75,
    content_type: str = 'image/webp',
) -> None:
    """
    Takes in a file and generates a thumbnail image (in the image/webp format)

    :param file_path: Upload file
    :param destination: Destination path
    :param max_size: Max size in pixels
    :param quality:
    :param content_type:
    :return:
    """
    image_format = CONTENT_TYPE_TO_FORMAT.get(content_type, 'WEBP')
    image = Image.open(file_path)
    image.thumbnail(max_size)
    image.save(destination, format=image_format, quality=quality)
