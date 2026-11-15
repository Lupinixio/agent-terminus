"""Secret sentinels and the encodings searched for when looking for leaks.

Same list as the Node adapter: raw, each 16-character half, URL-quoted, base64 and
urlsafe base64 (at every byte alignment), JSON-escaped, repr.
"""

from __future__ import annotations

import base64
import json
import secrets
import urllib.parse
from collections.abc import Iterable, Mapping
from dataclasses import dataclass


def make_sentinel() -> str:
    """A fresh sentinel: ``bk_`` + 32 hex characters."""
    return "bk_" + secrets.token_hex(16)


def _base64_core(text: str, offset: int) -> str:
    data = b"\0" * offset + text.encode("utf-8")
    encoded = base64.b64encode(data).decode("ascii")
    start_group = -(-offset // 3)
    end_group = len(data) // 3
    return encoded[start_group * 4 : end_group * 4]


def sentinel_forms(sentinel: str) -> list[tuple[str, str]]:
    """Every searched form of a sentinel as (label, text) pairs, deduplicated."""
    hex_part = sentinel[3:]
    forms = [
        ("raw", sentinel),
        ("first half", hex_part[:16]),
        ("second half", hex_part[16:]),
        ("url-quoted", urllib.parse.quote(sentinel, safe="")),
        ("json", json.dumps(sentinel)[1:-1]),
        ("repr", repr(sentinel)),
    ]
    for offset in (0, 1, 2):
        b64 = _base64_core(sentinel, offset)
        forms.append(("base64", b64))
        forms.append(("urlsafe base64", b64.replace("+", "-").replace("/", "_")))
    seen: set[str] = set()
    out = []
    for label, text in forms:
        if text and text not in seen:
            seen.add(text)
            out.append((label, text))
    return out


@dataclass(frozen=True)
class Leak:
    name: str
    source: str
    form: str


def find_leaks(texts: Iterable[tuple[str, str]], sentinels: Mapping[str, str]) -> list[Leak]:
    """Leaks of any sentinel in any (source, text) pair."""
    pairs = list(texts)
    leaks = []
    for name, sentinel in sentinels.items():
        forms = sentinel_forms(sentinel)
        for source, text in pairs:
            hit = next((label for label, form in forms if form in text), None)
            if hit:
                leaks.append(Leak(name, source, hit))
    return leaks
