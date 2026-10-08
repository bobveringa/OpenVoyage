import json
import subprocess

import pytest
from PIL import Image, PngImagePlugin, ImageCms

from utils.media.image_util import clean_image, clean_image_bytes, generate_image_thumbnail
from utils.media.video_util import clean_video, generate_video_thumbnail

PRIVATE = 'private-camera-location-52.37-4.90'


@pytest.mark.unit
@pytest.mark.parametrize(('image_format', 'mime', 'extension'), [
    ('JPEG', 'image/jpeg', '.jpg'), ('PNG', 'image/png', '.png'),
    ('WEBP', 'image/webp', '.webp'),
])
def test_images_and_thumbnails_strip_metadata_preserve_orientation_colour(
    tmp_path, image_format, mime, extension,
):
    source = tmp_path / ('source' + extension)
    output = tmp_path / ('clean' + extension)
    thumb = tmp_path / 'thumb.webp'
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = PRIVATE
    exif[271] = PRIVATE
    exif[306] = '2026:10:07 12:00:00'
    exif[34853] = {1: 'N', 2: (52.0, 22.0, 12.0), 3: 'E', 4: (4.0, 54.0, 0.0)}
    colour = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    options = {'exif': exif, 'icc_profile': colour}
    if image_format == 'PNG':
        text = PngImagePlugin.PngInfo()
        text.add_text('Description', PRIVATE)
        options['pnginfo'] = text
    elif image_format == 'WEBP':
        options['xmp'] = PRIVATE.encode()
    Image.new('RGB', (80, 40), 'red').save(source, format=image_format, **options)
    clean_image(str(source), str(output), mime)
    generate_image_thumbnail(str(output), str(thumb))
    for path in (output, thumb):
        assert PRIVATE.encode() not in path.read_bytes()
        with Image.open(path) as image:
            assert image.size == (40, 80)
            assert not image.getexif()
            assert not set(image.info) & {'xmp', 'exif', 'Description', 'comment'}
            assert image.info['icc_profile'] == colour
    content, content_type = clean_image_bytes(source.read_bytes())
    assert content_type == mime
    assert PRIVATE.encode() not in content


@pytest.mark.unit
@pytest.mark.parametrize('image_format', ['PNG', 'WEBP'])
def test_animation_and_transparency_survive_cleaning(tmp_path, image_format):
    source = tmp_path / ('animated.' + image_format.lower())
    output = tmp_path / ('clean.' + image_format.lower())
    frames = [Image.new('RGBA', (16, 16), colour) for colour in ('red', (0, 0, 255, 0))]
    frames[0].save(source, format=image_format, save_all=True, append_images=frames[1:],
                   duration=[100, 200], loop=2)
    clean_image(str(source), str(output), 'image/' + image_format.lower())
    with Image.open(output) as image:
        assert image.n_frames == 2
        assert image.info['loop'] == 2
        image.seek(1)
        assert image.convert('RGBA').getpixel((0, 0))[3] == 0


@pytest.mark.unit
def test_png_keeps_colour_chunks_without_descriptive_text(tmp_path):
    import struct
    source, output = tmp_path / 'source.png', tmp_path / 'clean.png'
    info = PngImagePlugin.PngInfo()
    info.add(b'gAMA', struct.pack('>I', 45455))
    info.add(b'sRGB', b'\0')
    info.add_text('Description', PRIVATE)
    Image.new('RGB', (16, 16), 'red').save(source, pnginfo=info)
    clean_image(str(source), str(output), 'image/png')
    with Image.open(output) as image:
        assert image.info['gamma'] == 0.45455
        assert image.info['srgb'] == 0
        assert 'Description' not in image.info


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, timeout=30)


@pytest.mark.unit
@pytest.mark.parametrize(('extension', 'video_codec', 'audio_codec'), [
    ('.mp4', 'libx264', 'aac'), ('.webm', 'libvpx-vp9', 'libopus'),
    ('.webm', 'libvpx', 'libvorbis'),
])
def test_videos_and_thumbnails_strip_metadata_preserve_audio(tmp_path, extension, video_codec, audio_codec):
    source = tmp_path / ('source' + extension)
    output = tmp_path / ('clean' + extension)
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i',
         'color=c=red:s=80x40:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
         '-c:v', video_codec, '-c:a', audio_codec, '-shortest',
         '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
         '-metadata', 'location=' + PRIVATE, '-metadata', 'title=' + PRIVATE,
         '-metadata', 'creation_time=2026-10-07T12:00:00Z',
         '-metadata:s:v', 'title=' + PRIVATE, '-metadata:s:a', 'comment=' + PRIVATE, str(source)])
    clean_video(str(source), str(output))
    assert PRIVATE.encode() not in output.read_bytes()
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(output)]).stdout)
    assert [stream['codec_type'] for stream in probe['streams']] == ['video', 'audio']
    assert probe['streams'][0]['width'] == 80
    assert probe['streams'][0]['height'] == 40
    assert probe['streams'][0]['color_primaries'] == 'bt709'
    assert probe['streams'][0]['color_transfer'] == 'bt709'
    assert probe['streams'][0]['color_space'] == 'bt709'
    assert float(probe['format']['duration']) == pytest.approx(0.5, abs=0.1)
    assert 'creation_time' not in probe['format'].get('tags', {})
    run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(output), '-f', 'null', '-'])
    thumb = tmp_path / 'thumb.webp'
    generate_video_thumbnail(str(output), str(thumb), timestamp=0)
    assert PRIVATE.encode() not in thumb.read_bytes()
    with Image.open(thumb) as image:
        assert not image.getexif()


@pytest.mark.unit
def test_video_failures_never_include_source_metadata(monkeypatch):
    import utils.media.video_util as util
    from types import SimpleNamespace
    monkeypatch.setattr(util.subprocess, 'run', lambda *a, **k:
                        SimpleNamespace(returncode=1, stdout='', stderr=PRIVATE))
    with pytest.raises(RuntimeError) as failure:
        clean_video('input.mp4', 'output.mp4')
    assert PRIVATE not in str(failure.value)


@pytest.mark.unit
def test_video_rotation_and_nonplayback_tracks(tmp_path):
    source = tmp_path / 'source.mp4'
    rotated = tmp_path / 'rotated.mp4'
    output = tmp_path / 'clean.mp4'
    subtitle = tmp_path / 'location.srt'
    subtitle.write_text('1\n00:00:00,000 --> 00:00:00,400\n' + PRIVATE + '\n')
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i',
         'color=c=red:s=80x40:d=0.5', '-i', str(subtitle), '-c:v', 'libx264',
         '-c:s', 'mov_text', str(source)])
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-display_rotation', '90', '-i', str(source),
         '-map', '0', '-c', 'copy', str(rotated)])
    clean_video(str(rotated), str(output))
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(output)]).stdout)
    assert len(probe['streams']) == 1
    assert probe['streams'][0]['side_data_list'][0]['rotation'] == 90
    assert PRIVATE.encode() not in output.read_bytes()
    thumb = tmp_path / 'thumb.webp'
    generate_video_thumbnail(str(output), str(thumb), timestamp=0)
    with Image.open(thumb) as image:
        assert image.size == (40, 80)


@pytest.mark.unit
def test_hlg_video_preserves_hdr_audio_rotation_and_cleans_thumbnail(tmp_path):
    source = tmp_path / 'synthetic-hlg.mp4'
    rotated = tmp_path / 'rotated-hlg.mp4'
    output = tmp_path / 'clean-hlg.mp4'
    thumbnail = tmp_path / 'thumbnail.webp'
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i',
         'color=c=red:s=80x40:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
         '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le',
         '-x265-params', 'info=0:pools=1:log-level=error', '-c:a', 'aac', '-shortest',
         '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
         '-metadata', 'location=' + PRIVATE, '-metadata', 'title=' + PRIVATE, str(source)])
    run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-display_rotation', '90', '-i', str(source),
         '-map', '0', '-c', 'copy', str(rotated)])
    clean_video(str(rotated), str(output))
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(output)]).stdout)
    video, audio = probe['streams']
    assert video['pix_fmt'] == 'yuv420p10le'
    assert video['color_transfer'] == 'arib-std-b67'
    assert video['color_primaries'] == 'bt2020'
    assert video['color_space'] == 'bt2020nc'
    assert video['side_data_list'][0]['rotation'] == 90
    assert audio['codec_name'] == 'aac'
    assert PRIVATE.encode() not in output.read_bytes()
    hashes = [run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-map', '0:v:0',
                   '-f', 'framemd5', '-']).stdout for path in (rotated, output)]
    assert hashes[0] == hashes[1]
    generate_video_thumbnail(str(output), str(thumbnail), timestamp=0)
    with Image.open(thumbnail) as image:
        assert image.size == (40, 80)
        assert not image.getexif()
        red, green, blue = image.convert('RGB').getpixel((20, 40))
        assert red > green and red > blue
    assert PRIVATE.encode() not in thumbnail.read_bytes()


@pytest.mark.unit
def test_video_codec_configuration_rejects_embedded_user_data():
    from utils.media.video_util import _check_codec_configuration
    # hvcC with one prefix-SEI array. Stream-copy filters cannot remove this
    # extradata, so the entire upload must fail instead of exposing the payload.
    header = b'\1' + bytes(21) + b'\1'
    payload = bytes([39 << 1, 1]) + PRIVATE.encode()
    data = header + bytes([39]) + b'\0\1' + len(payload).to_bytes(2, 'big') + payload
    with pytest.raises(ValueError, match='Descriptive data'):
        _check_codec_configuration({'codec_name': 'hevc', 'extradata': '\n00000000: ' + data.hex() + '  ...\n'})
