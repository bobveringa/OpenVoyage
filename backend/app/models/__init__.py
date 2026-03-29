from importlib import import_module
from pkgutil import iter_modules

from .base import Base

__all__ = ['Base']

# Auto-import every top-level module in this package except private modules and base.py
for module_info in iter_modules(__path__):
    module_name = module_info.name
    if module_name.startswith('_') or module_name == 'base':
        continue

    module = import_module(f'{__name__}.{module_name}')

    # Auto-export ORM classes that inherit Base
    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if isinstance(attr, type) and issubclass(attr, Base) and attr is not Base:
            globals()[attr_name] = attr
            __all__.append(attr_name)
