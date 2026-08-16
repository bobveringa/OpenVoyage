from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Any, Callable, Mapping

from core.setting_validators.common import (
    validate_http_url,
    validate_http_url_template,
)
from core.setting_validators.theme_palette import (
    DEFAULT_THEME_PALETTE,
    validate_theme_palette,
)


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


SettingValidator = Callable[[Any], Any]


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
    validator: SettingValidator | None = None

    def __post_init__(self) -> None:
        if self.validation is not None:
            object.__setattr__(
                self,
                'validation',
                MappingProxyType(dict(self.validation)),
            )


THEME_PALETTE_KEY = 'theme.palette'
MAP_TILE_PROVIDER_KEY = 'map.tile_provider'
DEFAULT_MAP_TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
ROUTING_PROVIDER_KEY = 'routing.provider'
ROUTING_GRAPHHOPPER_BASE_URL_KEY = 'routing.graphhopper_base_url'
ROUTING_GRAPHHOPPER_API_KEY = 'routing.graphhopper_api_key'
MEDIA_MAX_UPLOAD_SIZE_MB_KEY = 'media.max_upload_size_mb'
PLACES_GEONAMES_DATASET_KEY = 'places.geonames_dataset'
MEDIA_ORPHAN_RETENTION_DAYS_KEY = 'media.orphan_retention_days'

SETTING_DEFINITIONS = (
    SettingDefinition(
        key=THEME_PALETTE_KEY,
        value_type=SettingValueType.OBJECT,
        visibility=SettingVisibility.PUBLIC,
        sensitive=False,
        default_value=DEFAULT_THEME_PALETTE,
        runtime_safe=True,
        validator=validate_theme_palette,
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
            'max_length': 2048,
            'min_length': 1,
        },
        validator=validate_http_url_template,
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
        validator=validate_http_url,
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

        if definition.validator is not None:
            try:
                return definition.validator(value)
            except AppSettingValidationError:
                raise
            except ValueError as exc:
                raise AppSettingValidationError(str(exc)) from exc

        return value

    def _validate_definition(self, definition: SettingDefinition) -> None:
        if not definition.key or definition.key.strip() != definition.key:
            raise AppSettingRegistryError('App setting keys must be non-empty')
        if not definition.description:
            raise AppSettingRegistryError(
                f'App setting {definition.key} must have a description'
            )
        if definition.validator is not None and not callable(definition.validator):
            raise AppSettingRegistryError(
                f'App setting {definition.key} validator must be callable'
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


app_settings_registry = AppSettingsRegistry(SETTING_DEFINITIONS)
