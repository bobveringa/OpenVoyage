import json
import subprocess
from dataclasses import dataclass


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
    )

    if result.returncode != 0:
        raise RuntimeError(
            f'ffprobe failed (exit {result.returncode}):\n{result.stderr.strip()}'
        )

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
    for stream in ffprobe_data.get('streams', []):
        if stream.get('codec_type') == codec_type:
            return stream
    return None


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
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
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
    max_size: tuple[int, int] = (480, 480),
) -> tuple[int, int]:
    """Extract a single frame from *source* and write it as a JPEG to *dest*.

    Args:
        file_path:    Path to the uploaded video.
        dest:      Where to write the thumbnail (should end in .jpg/.jpeg).
        timestamp: Seconds into the video to grab the frame.  Defaults to
                   1 second so we skip black/fade-in frames at the start.
        max_size:  Bounding box; the frame is scaled down to fit inside this
                   while preserving aspect ratio.
    """
    scale_filter = (
        f"scale='min({max_size[0]},iw)':'min({max_size[1]},ih)'"
        ':force_original_aspect_ratio=decrease'
    )

    cmd = [
        'ffmpeg',
        '-y',  # overwrite dest without asking
        '-ss',
        str(timestamp),  # seek BEFORE input for speed
        '-i',
        file_path,
        '-vframes',
        '1',  # one frame only
        '-vf',
        scale_filter,
        '-q:v',
        '3',  # JPEG quality (2=best … 31=worst)
        dest,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f'ffmpeg thumbnail failed (exit {result.returncode}):\n{result.stderr.strip()}'
        )
