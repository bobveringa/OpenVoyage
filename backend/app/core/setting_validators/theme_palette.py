from __future__ import annotations

import json
import re
from typing import Any, Mapping


THEME_PALETTE_SCHEMA_VERSION = 1
THEME_PALETTE_ROLES = (
    'background',
    'foreground',
    'card',
    'cardForeground',
    'popover',
    'popoverForeground',
    'primary',
    'primaryForeground',
    'secondary',
    'secondaryForeground',
    'muted',
    'mutedForeground',
    'accent',
    'accentForeground',
    'border',
    'input',
    'ring',
)

DEFAULT_THEME_PALETTE = {
    'schema_version': THEME_PALETTE_SCHEMA_VERSION,
    'light': {
        'background': '#F7FBF7',
        'foreground': '#183026',
        'card': '#FFFFFF',
        'cardForeground': '#183026',
        'popover': '#FFFFFF',
        'popoverForeground': '#183026',
        'primary': '#246B49',
        'primaryForeground': '#FFFFFF',
        'secondary': '#EAF3EB',
        'secondaryForeground': '#264B37',
        'muted': '#EDF3ED',
        'mutedForeground': '#587064',
        'accent': '#D99A2B',
        'accentForeground': '#332711',
        'border': '#D4E1D6',
        'input': '#7C9483',
        'ring': '#2C7652',
    },
    'dark': {
        'background': '#121A27',
        'foreground': '#E8EEF1',
        'card': '#182231',
        'cardForeground': '#E8EEF1',
        'popover': '#182231',
        'popoverForeground': '#E8EEF1',
        'primary': '#65AFC8',
        'primaryForeground': '#101923',
        'secondary': '#263444',
        'secondaryForeground': '#DFE9ED',
        'muted': '#293746',
        'mutedForeground': '#AABAC2',
        'accent': '#E17D62',
        'accentForeground': '#111923',
        'border': '#35475A',
        'input': '#71869B',
        'ring': '#65AFC8',
    },
}

_HEX_COLOR_PATTERN = re.compile(r'^#[0-9A-Fa-f]{6}$')
_THEME_TEXT_PAIRS = (
    ('foreground', 'background'),
    ('cardForeground', 'card'),
    ('popoverForeground', 'popover'),
    ('primaryForeground', 'primary'),
    ('secondaryForeground', 'secondary'),
    ('mutedForeground', 'muted'),
    ('accentForeground', 'accent'),
)


def validate_theme_palette(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError('Theme palette must be an object')
    if set(value) != {'schema_version', 'light', 'dark'}:
        raise ValueError(
            'Theme palette must contain exactly schema_version, light, and dark'
        )
    if value.get('schema_version') != THEME_PALETTE_SCHEMA_VERSION:
        raise ValueError(
            f'Theme palette schema_version must be {THEME_PALETTE_SCHEMA_VERSION}'
        )

    normalized: dict[str, Any] = {'schema_version': THEME_PALETTE_SCHEMA_VERSION}
    for mode in ('light', 'dark'):
        palette = value.get(mode)
        if not isinstance(palette, dict) or set(palette) != set(THEME_PALETTE_ROLES):
            raise ValueError(
                f'Theme palette {mode} must contain every supported color role exactly once'
            )
        normalized_palette: dict[str, str] = {}
        for role in THEME_PALETTE_ROLES:
            color = palette[role]
            if not isinstance(color, str) or not _HEX_COLOR_PATTERN.fullmatch(color):
                raise ValueError(f'Theme palette {mode}.{role} must be a #RRGGBB color')
            normalized_palette[role] = color.upper()
        _validate_theme_palette_contrast(mode, normalized_palette)
        normalized[mode] = normalized_palette

    try:
        encoded = json.dumps(normalized, separators=(',', ':'), sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise ValueError('Theme palette must be JSON serializable') from exc
    if len(encoded.encode()) > 8192:
        raise ValueError('Theme palette must not exceed 8 KiB')
    return normalized


def _validate_theme_palette_contrast(mode: str, palette: Mapping[str, str]) -> None:
    for foreground_role, background_role in _THEME_TEXT_PAIRS:
        _require_contrast(mode, foreground_role, background_role, palette, minimum=4.5)
    for role in ('primary', 'mutedForeground'):
        for background_role in ('background', 'card'):
            _require_contrast(mode, role, background_role, palette, minimum=4.5)
    for background_role in ('background', 'card'):
        _require_contrast(mode, 'ring', background_role, palette, minimum=3.0)
        _require_contrast(mode, 'input', background_role, palette, minimum=3.0)


def _require_contrast(
    mode: str,
    foreground_role: str,
    background_role: str,
    palette: Mapping[str, str],
    *,
    minimum: float,
) -> None:
    ratio = _contrast_ratio(palette[foreground_role], palette[background_role])
    if ratio < minimum:
        raise ValueError(
            f'Theme palette {mode}.{foreground_role} requires {minimum:g}:1 contrast '
            f'against {background_role} (received {ratio:.2f}:1)'
        )


def _contrast_ratio(first: str, second: str) -> float:
    first_luminance = _relative_luminance(first)
    second_luminance = _relative_luminance(second)
    lighter, darker = sorted((first_luminance, second_luminance), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def _relative_luminance(color: str) -> float:
    channels = tuple(int(color[index : index + 2], 16) / 255 for index in (1, 3, 5))

    def linearize(channel: float) -> float:
        if channel <= 0.04045:
            return channel / 12.92
        return ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = (linearize(channel) for channel in channels)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
