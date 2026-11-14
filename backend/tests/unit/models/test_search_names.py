import pytest

from models.search_names import build_search_names, normalize_search_text

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ('text', 'expected'),
    [
        ('Zürich', 'zurich'),
        ('Málaga', 'malaga'),
        ('København', 'kobenhavn'),
        ('Ålesund', 'alesund'),
        ('Ærøskøbing', 'aeroskobing'),
        ('Œuilly', 'oeuilly'),
        ('Straße', 'strasse'),
        ('Łódź', 'lodz'),
        ('Đakovo', 'dakovo'),
        ('Þingvellir', 'thingvellir'),
        ('  São   Paulo ', 'sao paulo'),
        ('A|B', 'a b'),
    ],
)
def test_normalize_search_text_lowercases_strips_accents_and_folds_letters(text, expected):
    assert normalize_search_text(text) == expected


def test_build_search_names_puts_unique_names_between_marks():
    assert build_search_names(['München', 'Munich', 'munchen', '', None, 'Monaco di Baviera']) == (
        '|munchen|munich|monaco di baviera|'
    )


def test_build_search_names_without_names_is_empty_marks():
    assert build_search_names([]) == '||'
