"""The one search form of place names, shared by the import, the migration and the search.

Kept free of app imports so the Alembic migration can use it too.
"""

import unicodedata
from collections.abc import Iterable

# Letters that are not "a letter plus an accent", so stripping accents misses them.
_FOLDS = str.maketrans({
    'ø': 'o', 'å': 'a', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
    'ł': 'l', 'đ': 'd', 'þ': 'th', 'ð': 'd', 'ı': 'i',
})


def normalize_search_text(value: str) -> str:
    """Lowercase, strip accents and fold special letters: "København" -> "kobenhavn"."""
    lowered = value.lower().translate(_FOLDS)
    decomposed = unicodedata.normalize('NFKD', lowered)
    stripped = ''.join(char for char in decomposed if not unicodedata.combining(char))
    # The | marks separate names, so a name can never contain one.
    return ' '.join(stripped.replace('|', ' ').split())


def build_search_names(names: Iterable[str | None]) -> str:
    """Every name in search form between | marks, for example ``|munchen|munich|``."""
    seen: list[str] = []
    for name in names:
        normalized = normalize_search_text(name or '')
        if normalized and normalized not in seen:
            seen.append(normalized)
    return '|' + '|'.join(seen) + '|' if seen else '||'
