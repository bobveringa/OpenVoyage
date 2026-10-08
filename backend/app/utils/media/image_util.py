from dataclasses import dataclass
from io import BytesIO
import struct

from PIL import Image, ImageCms, ImageOps, ImageSequence, PngImagePlugin


@dataclass
class ImageInfo:
    width: int
    height: int


def get_image_info(file: str) -> ImageInfo:
    with Image.open(file) as image:
        width, height = image.size
    return ImageInfo(width=width, height=height)


CONTENT_TYPE_TO_FORMAT = {
    'image/webp': 'WEBP',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
}


def _clean_pixels(source: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(source)
    if image.mode == 'P' or 'transparency' in image.info:
        image = image.convert('RGBA')
    # Rebuild from pixels: copy() and info.clear() alone can retain EXIF caches.
    return Image.frombytes(image.mode, image.size, image.tobytes())


def _save_clean_image(source: Image.Image, destination, image_format: str) -> None:
    options = {}
    if source.info.get('icc_profile'):
        options['icc_profile'] = source.info['icc_profile']
    if image_format == 'PNG':
        colour = PngImagePlugin.PngInfo()
        if 'gamma' in source.info:
            colour.add(b'gAMA', struct.pack('>I', round(source.info['gamma'] * 100000)))
        if 'chromaticity' in source.info:
            colour.add(b'cHRM', struct.pack('>8I', *(round(value * 100000)
                                                    for value in source.info['chromaticity'])))
        if 'srgb' in source.info:
            colour.add(b'sRGB', bytes([source.info['srgb']]))
        options['pnginfo'] = colour
    frames = []
    durations = []
    for frame in ImageSequence.Iterator(source):
        frames.append(_clean_pixels(frame))
        durations.append(frame.info.get('duration', 0))
    if len(frames) > 1:
        if image_format not in {'PNG', 'WEBP'}:
            raise ValueError('Cannot preserve animation in this image format')
        options.update(save_all=True, append_images=frames[1:], duration=durations,
                       loop=source.info.get('loop', 0))
        if image_format == 'PNG':
            options.update(disposal=0, blend=0)
            if source.info.get('default_image'):
                options['default_image'] = True
                options['duration'] = durations[1:]
    if image_format == 'JPEG':
        options.update(quality=95, subsampling=0)
    elif image_format == 'WEBP':
        options['lossless'] = True
    frames[0].save(destination, format=image_format, **options)


def clean_image(file_path: str, destination: str, content_type: str) -> None:
    with Image.open(file_path) as source:
        _save_clean_image(source, destination, CONTENT_TYPE_TO_FORMAT[content_type])


def clean_image_bytes(content: bytes) -> tuple[bytes, str]:
    with Image.open(BytesIO(content)) as source:
        content_type = next((mime for mime, fmt in CONTENT_TYPE_TO_FORMAT.items()
                             if fmt == source.format), None)
        if content_type is None:
            raise ValueError('Unsupported preview image format')
        output = BytesIO()
        _save_clean_image(source, output, CONTENT_TYPE_TO_FORMAT[content_type])
        return output.getvalue(), content_type


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
    with Image.open(file_path) as source:
        # Camera uploads commonly store their intended display rotation in EXIF
        # rather than in the pixel data. Apply it before calculating the thumbnail
        # dimensions so portrait images remain portrait in the generated file.
        image = _clean_pixels(source)
        profile = source.info.get('icc_profile')
        if image.mode == 'CMYK' and profile:
            target_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
            image = ImageCms.profileToProfile(
                image, ImageCms.ImageCmsProfile(BytesIO(profile)), target_profile,
                outputMode='RGB',
            )
            profile = target_profile.tobytes()
            image = _clean_pixels(image)
        image.thumbnail(max_size)
        options = {'icc_profile': profile} if profile else {}
        image.save(destination, format=image_format, quality=quality, **options)
