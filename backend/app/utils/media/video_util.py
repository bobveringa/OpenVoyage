import json
import subprocess
from dataclasses import dataclass


VIDEO_THUMBNAIL_MAX_SIZE = (960, 960)
VIDEO_THUMBNAIL_QUALITY = 90
PROCESS_TIMEOUT_SECONDS = 300


class VideoCleaningError(ValueError):
    """A known cleaning rejection with a metadata-free diagnostic code."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    # Never include subprocess output in errors: it can contain source metadata.
    result = subprocess.run(cmd, capture_output=True, text=True, check=False,
                            timeout=PROCESS_TIMEOUT_SECONDS)
    if result.returncode:
        raise RuntimeError(f'{cmd[0]} failed (exit {result.returncode})')
    return result


def _check_codec_configuration(stream: dict) -> None:
    """Stream-copy filters leave codec extradata unchanged; allow parameter sets only."""
    codec = stream['codec_name']
    if codec not in {'h264', 'hevc'}:
        return
    dump = stream.get('extradata', '')
    data = bytes.fromhex(''.join(line.split(':', 1)[1].split('  ', 1)[0].strip()
                                for line in dump.splitlines() if ':' in line))
    if not data or data[0] != 1:
        raise ValueError('Unknown video codec configuration')
    position = 0

    def read(size: int) -> bytes:
        nonlocal position
        value = data[position:position + size]
        if len(value) != size:
            raise ValueError('Invalid codec configuration')
        position += size
        return value

    def parameter_sets(count: int, allowed: set[int]) -> None:
        for _ in range(count):
            nal = read(int.from_bytes(read(2), 'big'))
            if not nal:
                raise ValueError('Empty codec parameter set')
            unit_type = nal[0] & 31 if codec == 'h264' else (nal[0] >> 1) & 63
            if unit_type not in allowed:
                raise VideoCleaningError('Descriptive data in codec configuration', 'unsafe_codec_configuration')

    if codec == 'h264':
        read(5)
        parameter_sets(read(1)[0] & 31, {7})
        parameter_sets(read(1)[0], {8})
        if position < len(data):
            read(3)  # Chroma format and bit depths for high profiles.
            parameter_sets(read(1)[0], {13})
    else:
        read(22)
        for _ in range(read(1)[0]):
            unit_type = read(1)[0] & 63
            if unit_type not in {32, 33, 34}:
                raise VideoCleaningError('Descriptive data in codec configuration', 'unsafe_codec_configuration')
            parameter_sets(int.from_bytes(read(2), 'big'), {unit_type})
    if position != len(data):
        raise ValueError('Unexpected codec configuration data')


def clean_video(file_path: str, destination: str) -> None:
    """Remux only known playback streams, stripping tags, chapters and user data."""
    probe = json.loads(_run([
        'ffprobe', '-v', 'error', '-show_streams', '-of', 'json', file_path,
    ]).stdout)
    streams = [stream for stream in probe['streams']
               if stream.get('codec_type') in {'video', 'audio'}
               and not stream.get('disposition', {}).get('attached_pic')]
    if not any(stream['codec_type'] == 'video' for stream in streams):
        raise ValueError('No playable video stream')
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', file_path]
    for stream in streams:
        cmd += ['-map', f"0:{stream['index']}"]
    cmd += ['-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
            '-c', 'copy', '-fflags', '+bitexact', '-metadata', 'encoder=']
    video_index = 0
    for stream in streams:
        codec = stream['codec_name']
        if stream['codec_type'] == 'video':
            if codec not in {'h264', 'hevc', 'vp8', 'vp9'}:
                raise VideoCleaningError('Video codec cannot be safely cleaned', 'unsupported_video_codec')
            if codec in {'h264', 'hevc'}:
                # PQ HDR can depend on mastering/dynamic information in SEI.
                # HLG's colour signal lives in parameter sets, which are retained.
                if stream.get('color_transfer') == 'smpte2084':
                    raise VideoCleaningError('HDR video cannot be safely remuxed', 'unsupported_hdr')
                cmd += [f'-bsf:v:{video_index}',
                        'filter_units=remove_types=' + ('6' if codec == 'h264' else '39|40')]
            video_index += 1
        elif codec not in {'aac', 'mp3', 'opus', 'vorbis'}:
            raise VideoCleaningError('Audio codec cannot be safely cleaned', 'unsupported_audio_codec')
    cmd.append(destination)
    _run(cmd)
    # Independently check the remuxed container and stream metadata. The muxer
    # creates fixed technical tags; no source descriptions may survive.
    output = json.loads(_run([
        'ffprobe', '-v', 'error', '-show_streams', '-show_data', '-show_format', '-show_chapters',
        '-of', 'json', destination,
    ]).stdout)
    allowed_tags = {'major_brand', 'minor_version', 'compatible_brands', 'language',
                    'handler_name', 'vendor_id', 'duration'}
    if output.get('chapters') or len(output['streams']) != len(streams):
        raise ValueError('Unexpected output tracks or chapters')
    colour_fields = ('pix_fmt', 'color_range', 'color_space', 'color_transfer', 'color_primaries')
    for original, stream in zip(streams, output['streams'], strict=True):
        if stream['codec_type'] == 'video':
            _check_codec_configuration(stream)
            if any(original.get(field) not in {None, 'unknown'}
                   and original[field] != stream.get(field) for field in colour_fields):
                raise VideoCleaningError('Video colour information changed', 'colour_information_changed')
    for item in [output.get('format', {}), *output['streams']]:
        tags = {key.lower(): value for key, value in item.get('tags', {}).items()}
        # WebM's mandatory WritingApp field is generated as this fixed value by
        # the bitexact muxer. It is never copied from the source.
        if tags.get('encoder') == 'Lavf':
            tags.pop('encoder')
        if set(tags) - allowed_tags:
            raise ValueError('Unexpected metadata in cleaned video')


@dataclass
class VideoInfo:
    width: int
    height: int
    duration: float


def get_video_info(path: str) -> VideoInfo:
    """Return pixel dimensions and duration of a video via ffprobe.

    ffprobe is part of the ffmpeg suite and is available on macOS, Linux,
    and Windows.  It is called as a subprocess and must be on PATH.

    Raises:
        FileNotFoundError: if ffprobe is not on PATH.
        RuntimeError:      if ffprobe exits with a non-zero code.
        ValueError:        if the expected fields are missing from output.
    """
    cmd = [
        'ffprobe',
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        '-show_entries',
        'stream=width,height,duration,codec_type',
        path,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
        timeout=PROCESS_TIMEOUT_SECONDS,
    )

    if result.returncode != 0:
        raise RuntimeError(f'ffprobe failed (exit {result.returncode})')

    data = json.loads(result.stdout)
    video_stream = _first_stream(data, 'video')
    if video_stream is None:
        raise ValueError('No video stream found in file.')

    width = int(video_stream['width'])
    height = int(video_stream['height'])

    # Duration may live on the stream or need to be read from the container.
    duration = _parse_duration(video_stream, path)

    return VideoInfo(width=width, height=height, duration=duration)


def _first_stream(ffprobe_data: dict, codec_type: str) -> dict | None:
    response = None
    for stream in ffprobe_data.get('streams', []):
        if stream.get('codec_type') == codec_type:
            response = stream
            break
    return response


def _parse_duration(video_stream: dict, path: str) -> float:
    """Extract duration in seconds, falling back to container-level probe."""
    raw = video_stream.get('duration')
    if raw is not None:
        return float(raw)

    # Some formats (e.g. MKV) store duration at the container level only.
    cmd = [
        'ffprobe',
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_entries',
        'format=duration',
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False,
                            timeout=PROCESS_TIMEOUT_SECONDS)
    if result.returncode == 0:
        data = json.loads(result.stdout)
        raw = data.get('format', {}).get('duration')
        if raw is not None:
            return float(raw)

    raise ValueError('Could not determine video duration.')


def generate_video_thumbnail(
    file_path: str,
    dest: str,
    timestamp: float = 1.0,
    max_size: tuple[int, int] = VIDEO_THUMBNAIL_MAX_SIZE,
    quality: int = VIDEO_THUMBNAIL_QUALITY,
) -> None:
    """Extract a single frame from *source* and write it as WebP to *dest*.

    Args:
        file_path:    Path to the uploaded video.
        dest:      Where to write the WebP thumbnail.
        timestamp: Seconds into the video to grab the frame.  Defaults to
                   1 second so we skip black/fade-in frames at the start.
        max_size:  Bounding box; the frame is scaled down to fit inside this
                   while preserving aspect ratio.
        quality:   WebP encoder quality from 0 to 100.
    """
    scale_filter = (
        f"scale='min({max_size[0]},iw)':'min({max_size[1]},ih)'"
        ':force_original_aspect_ratio=decrease'
    )
    probe = json.loads(_run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=color_transfer', '-of', 'json', file_path,
    ]).stdout)
    if probe['streams'][0].get('color_transfer') in {'arib-std-b67', 'smpte2084'}:
        # Produce a standard sRGB preview while the stored video retains HDR.
        scale_filter += (
            ',zscale=transfer=linear:npl=100,format=gbrpf32le'
            ',zscale=primaries=bt709,tonemap=tonemap=hable:desat=0'
            ',zscale=transfer=iec61966-2-1:matrix=gbr:range=full,format=rgb24'
        )

    cmd = [
        'ffmpeg',
        '-nostdin',
        '-v',
        'error',
        '-y',  # overwrite dest without asking
        '-ss',
        str(timestamp),  # seek BEFORE input for speed
        '-i',
        file_path,
        '-map',
        '0:v:0',
        '-map_metadata',
        '-1',
        '-map_metadata:s',
        '-1',
        '-vframes',
        '1',  # one frame only
        '-vf',
        scale_filter,
        '-c:v',
        'libwebp',
        '-preset',
        'photo',
        '-quality',
        str(quality),
        dest,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
        timeout=PROCESS_TIMEOUT_SECONDS,
    )

    if result.returncode != 0:
        raise RuntimeError(f'ffmpeg thumbnail failed (exit {result.returncode})')
