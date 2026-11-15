"""The Wikipedia client's requests and parsing, with the network replaced."""

import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest

from services.place_photo_service import PhotoFetchError, WikipediaClient, plain_text

pytestmark = pytest.mark.unit


class Recorder(WikipediaClient):
    def __init__(self, answers):
        self.answers = list(answers)
        self.urls: list[str] = []

    def _get(self, url, deadline):
        self.urls.append(url)
        return json.dumps(self.answers.pop(0)).encode()


def query(url):
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


def test_lead_image_asks_english_wikipedia_for_free_images_only():
    client = Recorder([{'query': {'pages': [{'title': 'Barcelona', 'pageimage': 'Barcelona_skyline.jpg'}]}}])

    assert client.lead_image('Barcelona', time.monotonic() + 3) == 'Barcelona_skyline.jpg'
    url = client.urls[0]
    assert url.startswith('https://en.wikipedia.org/w/api.php?')
    assert query(url)['pilicense'] == 'free'
    assert query(url)['titles'] == 'Barcelona'


def test_lead_image_is_none_without_a_free_image():
    client = Recorder([{'query': {'pages': [{'title': 'Liempde'}]}}])
    assert client.lead_image('Liempde', time.monotonic() + 3) is None


def test_commons_file_gives_the_800px_url_and_a_plain_text_credit():
    client = Recorder([{'query': {'pages': [{'imageinfo': [{
        'thumburl': 'https://upload.wikimedia.org/x/800px-A.jpg',
        'url': 'https://upload.wikimedia.org/x/A.jpg',
        'descriptionurl': 'https://commons.wikimedia.org/wiki/File:A.jpg',
        'extmetadata': {
            'Artist': {'value': '<a href="//commons.wikimedia.org/wiki/User:Poco">Diego <b>Delso</b></a>'},
            'LicenseShortName': {'value': 'CC BY-SA 3.0'},
        },
    }]}]}}])

    file = client.commons_file('A.jpg', time.monotonic() + 3)
    assert file.thumb_url == 'https://upload.wikimedia.org/x/800px-A.jpg'
    assert file.source_url == 'https://commons.wikimedia.org/wiki/File:A.jpg'
    assert file.credit == 'Diego Delso'
    assert file.license == 'CC BY-SA 3.0'
    url = client.urls[0]
    assert url.startswith('https://commons.wikimedia.org/w/api.php?')
    assert query(url)['iiurlwidth'] == '800'
    assert query(url)['titles'] == 'File:A.jpg'


def test_commons_file_missing_is_none():
    client = Recorder([{'query': {'pages': [{'missing': True}]}}])
    assert client.commons_file('Gone.jpg', time.monotonic() + 3) is None


def test_downloads_only_come_from_wikimedia():
    client = Recorder([])
    client._get = lambda url, deadline: b'image'
    for url in ('https://upload.wikimedia.org/a.jpg',
                'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/A.jpg/960px-A.jpg?utm_source=x'):
        assert client.download(url, time.monotonic() + 3) == b'image'
    client = WikipediaClient()
    with pytest.raises(PhotoFetchError):
        client.download('https://example.com/a.jpg', time.monotonic() + 3)
    with pytest.raises(PhotoFetchError):
        client.download('http://upload.wikimedia.org/a.jpg', time.monotonic() + 3)
    with pytest.raises(PhotoFetchError):
        client.download('https://thumb.wikimedia.org.example.com/a.jpg', time.monotonic() + 3)


def test_nothing_is_fetched_once_the_3_second_budget_is_used():
    with pytest.raises(PhotoFetchError):
        WikipediaClient()._get('https://en.wikipedia.org/w/api.php', time.monotonic() - 0.1)


def test_plain_text_strips_html():
    assert plain_text('<span>Photo by <i>Anna</i></span>  ') == 'Photo by Anna'
    assert plain_text(None) is None
    assert plain_text('<br>') is None
