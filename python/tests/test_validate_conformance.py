"""The hand validators agree with the JSON schemas on the shared corpus."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import pytest
from conftest import REPO
from jsonschema import Draft202012Validator

from boundaries_kit.validate import validate_kit, validate_manifest

SCHEMAS = {
    kind: Draft202012Validator(json.loads((REPO / "schema" / f"{kind}.schema.json").read_text(encoding="utf-8")))
    for kind in ("manifest", "kit")
}
VALIDATORS = {"manifest": validate_manifest, "kit": validate_kit}


def _cases(validity: str) -> list[tuple[str, Path]]:
    return [
        (kind, path)
        for kind in ("manifest", "kit")
        for path in sorted((REPO / "schema" / "fixtures" / kind / validity).glob("*.toml"))
    ]


@pytest.mark.parametrize(("kind", "path"), _cases("valid"), ids=lambda v: v.name if isinstance(v, Path) else v)
def test_valid(kind: str, path: Path) -> None:
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    assert list(SCHEMAS[kind].iter_errors(raw)) == []
    assert VALIDATORS[kind](raw, path.name) == []


@pytest.mark.parametrize(("kind", "path"), _cases("invalid"), ids=lambda v: v.name if isinstance(v, Path) else v)
def test_invalid(kind: str, path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^# expect: (\S+)", text)
    assert match, 'invalid fixtures start with "# expect: <key>"'
    raw = tomllib.loads(text)
    assert not SCHEMAS[kind].is_valid(raw), "the JSON schema rejects it"
    keys = [p.key for p in VALIDATORS[kind](raw, path.name)]
    assert match.group(1) in keys


def test_corpus_is_not_empty() -> None:
    assert len(_cases("valid")) >= 4
    assert len(_cases("invalid")) >= 20
