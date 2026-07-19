from __future__ import annotations

import json
import sys
from typing import Any
from pathlib import Path


def normalize_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Adjust framework-level schemas that Dart generators handle poorly."""
    schema.setdefault('servers', [{'url': 'http://localhost:8000'}])

    validation_error = (
        schema.get('components', {}).get('schemas', {}).get('ValidationError')
    )
    if isinstance(validation_error, dict):
        loc = validation_error.get('properties', {}).get('loc')
        if isinstance(loc, dict) and loc.get('type') == 'array':
            loc['items'] = {
                'description': 'Validation error location path component.',
            }

    for path_item in schema.get('paths', {}).values():
        if not isinstance(path_item, dict):
            continue
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            for parameter in operation.get('parameters', []):
                if not isinstance(parameter, dict) or parameter.get('in') != 'query':
                    continue
                parameter_schema = parameter.get('schema')
                if (
                    isinstance(parameter_schema, dict)
                    and '$ref' in parameter_schema
                    and 'default' in parameter_schema
                ):
                    parameter_schema.pop('default')

    return schema


def main() -> None:
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('openapi.json')
    backend_root = Path(__file__).resolve().parents[1]
    app_root = backend_root / 'app'
    sys.path.insert(0, str(app_root))

    from main import app

    schema = normalize_schema(app.openapi())
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(schema, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    print(f'Wrote {output_path.resolve()}')


if __name__ == '__main__':
    main()
