from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Any, Mapping

from pydantic import AnyHttpUrl, TypeAdapter, ValidationError


class SettingValueType(str, Enum):
    ENUM = 'enum'
    STRING = 'string'
    SECRET = 'secret'
    BOOLEAN = 'boolean'
    INTEGER = 'integer'
    OBJECT = 'object'


class SettingVisibility(str, Enum):
    PUBLIC = 'public'
    ADMIN = 'admin'
    INTERNAL = 'internal'


class AppSettingRegistryError(ValueError):
    """Raised when code-defined setting metadata is inconsistent."""


class AppSettingValidationError(ValueError):
    """Raised when an admin replacement value fails registry validation."""


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    value_type: SettingValueType
    visibility: SettingVisibility
    sensitive: bool
    runtime_safe: bool
    description: str
    default_value: Any = None
    validation: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.validation is not None:
            object.__setattr__(
                self,
                'validation',
                MappingProxyType(dict(self.validation)),
            )


THEME_DARKMODE_KEY = 'theme.darkmode'
THEME_PALETTE_KEY = 'theme.palette'
MAP_TILE_PROVIDER_KEY = 'map.tile_provider'
DEFAULT_MAP_TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
ROUTING_PROVIDER_KEY = 'routing.provider'
ROUTING_GRAPHHOPPER_BASE_URL_KEY = 'routing.graphhopper_base_url'
ROUTING_GRAPHHOPPER_API_KEY = 'routing.graphhopper_api_key'
MEDIA_MAX_UPLOAD_SIZE_MB_KEY = 'media.max_upload_size_mb'
PLACES_GEONAMES_DATASET_KEY = 'places.geonames_dataset'
MEDIA_ORPHAN_RETENTION_DAYS_KEY = 'media.orphan_retention_days'

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


SETTING_DEFINITIONS = (
    SettingDefinition(
        key=THEME_DARKMODE_KEY,
        value_type=SettingValueType.ENUM,
        visibility=SettingVisibility.PUBLIC,
        sensitive=False,
        default_value='system',
        runtime_safe=True,
        validation={'allowed_values': ['enabled', 'disabled', 'system']},
        description=(
            'Legacy site theme mode. Visitor preference now controls the active mode.'
        ),
    ),
    SettingDefinition(
        key=THEME_PALETTE_KEY,
        value_type=SettingValueType.OBJECT,
        visibility=SettingVisibility.PUBLIC,
        sensitive=False,
        default_value=DEFAULT_THEME_PALETTE,
        runtime_safe=True,
        validation={'format': 'theme-palette-v1'},
        description='Shared light and dark application color palettes.',
    ),
    SettingDefinition(
        key=MAP_TILE_PROVIDER_KEY,
        value_type=SettingValueType.STRING,
        visibility=SettingVisibility.PUBLIC,
        sensitive=False,
        default_value=DEFAULT_MAP_TILE_PROVIDER_URL,
        runtime_safe=True,
        validation={
            'format': 'http-url-template',
            'max_length': 2048,
            'min_length': 1,
        },
        description='Tile URL template used by interactive maps.',
    ),
    SettingDefinition(
        key=ROUTING_PROVIDER_KEY,
        value_type=SettingValueType.ENUM,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        default_value='none',
        runtime_safe=False,
        validation={'allowed_values': ['none', 'graphhopper']},
        description='Route provider used when generating itinerary travel routes.',
    ),
    SettingDefinition(
        key=ROUTING_GRAPHHOPPER_BASE_URL_KEY,
        value_type=SettingValueType.STRING,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        default_value='https://graphhopper.com/api/1',
        runtime_safe=False,
        validation={'format': 'http-url'},
        description='GraphHopper API base URL used by route generation.',
    ),
    SettingDefinition(
        key=ROUTING_GRAPHHOPPER_API_KEY,
        value_type=SettingValueType.SECRET,
        visibility=SettingVisibility.ADMIN,
        sensitive=True,
        runtime_safe=False,
        validation={'min_length': 1, 'max_length': 2048},
        description='GraphHopper API key used by route generation.',
    ),
    SettingDefinition(
        key=MEDIA_MAX_UPLOAD_SIZE_MB_KEY,
        value_type=SettingValueType.INTEGER,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        default_value=512,
        runtime_safe=True,
        validation={'min': 1, 'max': 5120, 'unit': 'MB'},
        description='Maximum accepted media upload size in megabytes.',
    ),
    SettingDefinition(
        key=PLACES_GEONAMES_DATASET_KEY,
        value_type=SettingValueType.ENUM,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        default_value='cities500',
        runtime_safe=True,
        validation={
            'allowed_values': [
                'cities500',
                'cities1000',
                'cities5000',
                'cities15000',
                'allCountries',
            ]
        },
        description='GeoNames dataset used by the scheduled places import.',
    ),
    SettingDefinition(
        key=MEDIA_ORPHAN_RETENTION_DAYS_KEY,
        value_type=SettingValueType.INTEGER,
        visibility=SettingVisibility.ADMIN,
        sensitive=False,
        default_value=1,
        runtime_safe=True,
        validation={'min': 1, 'unit': 'days'},
        description='Minimum age before unattached media is eligible for cleanup.',
    ),
)


_HTTP_URL_ADAPTER = TypeAdapter(AnyHttpUrl)


class AppSettingsRegistry:
    def __init__(self, definitions: tuple[SettingDefinition, ...]) -> None:
        self._definitions = definitions
        self._by_key: dict[str, SettingDefinition] = {}
        for definition in definitions:
            self._validate_definition(definition)
            if definition.key in self._by_key:
                raise AppSettingRegistryError(
                    f'Duplicate app setting key: {definition.key}'
                )
            self._by_key[definition.key] = definition

    @property
    def definitions(self) -> tuple[SettingDefinition, ...]:
        return self._definitions

    def get(self, key: str) -> SettingDefinition | None:
        return self._by_key.get(key)

    def require(self, key: str) -> SettingDefinition:
        definition = self.get(key)
        if definition is None:
            raise KeyError(key)
        return definition

    def validate_value(self, definition: SettingDefinition, value: Any) -> Any:
        if value is None:
            raise AppSettingValidationError('Value must not be null')

        if definition.key == THEME_PALETTE_KEY:
            return _validate_theme_palette(value)

        value_type = definition.value_type
        validation = definition.validation or {}

        if value_type in (
            SettingValueType.STRING,
            SettingValueType.SECRET,
            SettingValueType.ENUM,
        ):
            if not isinstance(value, str):
                raise AppSettingValidationError('Value must be a string')
        elif value_type == SettingValueType.BOOLEAN:
            if not isinstance(value, bool):
                raise AppSettingValidationError('Value must be a boolean')
        elif value_type == SettingValueType.INTEGER:
            if not isinstance(value, int) or isinstance(value, bool):
                raise AppSettingValidationError('Value must be an integer')
        elif value_type == SettingValueType.OBJECT:
            if not isinstance(value, dict):
                raise AppSettingValidationError('Value must be an object')

        allowed_values = validation.get('allowed_values')
        if allowed_values is not None and value not in allowed_values:
            choices = ', '.join(str(choice) for choice in allowed_values)
            raise AppSettingValidationError(f'Value must be one of: {choices}')

        minimum = validation.get('min')
        if minimum is not None and value < minimum:
            raise AppSettingValidationError(f'Value must be at least {minimum}')

        maximum = validation.get('max')
        if maximum is not None and value > maximum:
            raise AppSettingValidationError(f'Value must be at most {maximum}')

        min_length = validation.get('min_length')
        if min_length is not None and len(value) < min_length:
            raise AppSettingValidationError(
                f'Value must contain at least {min_length} character(s)'
            )

        max_length = validation.get('max_length')
        if max_length is not None and len(value) > max_length:
            raise AppSettingValidationError(
                f'Value must contain at most {max_length} character(s)'
            )

        if validation.get('format') == 'http-url':
            try:
                _HTTP_URL_ADAPTER.validate_python(value)
            except ValidationError as exc:
                raise AppSettingValidationError(
                    'Value must be a valid HTTP or HTTPS URL'
                ) from exc
        elif validation.get('format') == 'http-url-template':
            lower_value = value.lower()
            if not (
                lower_value.startswith('http://') or lower_value.startswith('https://')
            ):
                raise AppSettingValidationError(
                    'Value must be an HTTP or HTTPS URL template'
                )
            if any(character.isspace() for character in value):
                raise AppSettingValidationError('Value must not contain whitespace')

        return value

    def _validate_definition(self, definition: SettingDefinition) -> None:
        if not definition.key or definition.key.strip() != definition.key:
            raise AppSettingRegistryError('App setting keys must be non-empty')
        if not definition.description:
            raise AppSettingRegistryError(
                f'App setting {definition.key} must have a description'
            )
        if definition.visibility == SettingVisibility.PUBLIC and definition.sensitive:
            raise AppSettingRegistryError(
                f'Public app setting {definition.key} cannot be sensitive'
            )
        if definition.value_type == SettingValueType.SECRET:
            if definition.visibility != SettingVisibility.ADMIN:
                raise AppSettingRegistryError(
                    f'Secret app setting {definition.key} must be admin-visible'
                )
            if not definition.sensitive:
                raise AppSettingRegistryError(
                    f'Secret app setting {definition.key} must be sensitive'
                )
            if definition.default_value is not None:
                raise AppSettingRegistryError(
                    f'Secret app setting {definition.key} cannot have a default'
                )
        elif definition.sensitive:
            raise AppSettingRegistryError(
                f'Non-secret app setting {definition.key} cannot be sensitive'
            )

        if definition.value_type != SettingValueType.SECRET:
            if definition.default_value is None:
                raise AppSettingRegistryError(
                    f'Non-secret app setting {definition.key} must have a default'
                )
            try:
                self.validate_value(definition, definition.default_value)
            except AppSettingValidationError as exc:
                raise AppSettingRegistryError(
                    f'Invalid default for app setting {definition.key}: {exc}'
                ) from exc


def _validate_theme_palette(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AppSettingValidationError('Theme palette must be an object')

    if set(value) != {'schema_version', 'light', 'dark'}:
        raise AppSettingValidationError(
            'Theme palette must contain exactly schema_version, light, and dark'
        )
    if value.get('schema_version') != THEME_PALETTE_SCHEMA_VERSION:
        raise AppSettingValidationError(
            f'Theme palette schema_version must be {THEME_PALETTE_SCHEMA_VERSION}'
        )

    normalized: dict[str, Any] = {
        'schema_version': THEME_PALETTE_SCHEMA_VERSION,
    }
    for mode in ('light', 'dark'):
        palette = value.get(mode)
        if not isinstance(palette, dict) or set(palette) != set(THEME_PALETTE_ROLES):
            raise AppSettingValidationError(
                f'Theme palette {mode} must contain every supported color role exactly once'
            )
        normalized_palette: dict[str, str] = {}
        for role in THEME_PALETTE_ROLES:
            color = palette[role]
            if not isinstance(color, str) or not _HEX_COLOR_PATTERN.fullmatch(color):
                raise AppSettingValidationError(
                    f'Theme palette {mode}.{role} must be a #RRGGBB color'
                )
            normalized_palette[role] = color.upper()
        _validate_theme_palette_contrast(mode, normalized_palette)
        normalized[mode] = normalized_palette

    try:
        encoded = json.dumps(normalized, separators=(',', ':'), sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise AppSettingValidationError('Theme palette must be JSON serializable') from exc
    if len(encoded.encode()) > 8192:
        raise AppSettingValidationError('Theme palette must not exceed 8 KiB')
    return normalized


def _validate_theme_palette_contrast(mode: str, palette: Mapping[str, str]) -> None:
    for foreground_role, background_role in _THEME_TEXT_PAIRS:
        _require_contrast(
            mode,
            foreground_role,
            background_role,
            palette,
            minimum=4.5,
        )

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
        raise AppSettingValidationError(
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


app_settings_registry = AppSettingsRegistry(SETTING_DEFINITIONS)
