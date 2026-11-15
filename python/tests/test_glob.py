from __future__ import annotations

import json

from conftest import REPO

from agent_terminus.glob import literal_prefix, match


def test_shared_glob_cases() -> None:
    cases = json.loads((REPO / "schema" / "fixtures" / "globs.json").read_text(encoding="utf-8"))
    assert cases
    for c in cases:
        assert match(c["glob"], c["path"], nocase=c.get("nocase", False)) is c["match"], c


def test_backslash_paths_are_normalized() -> None:
    assert match(".boundaries/**", ".boundaries\\web.toml")


def test_literal_prefix() -> None:
    assert literal_prefix(".boundaries/**") == ".boundaries/"
    assert literal_prefix("CODEOWNERS") == "CODEOWNERS"
