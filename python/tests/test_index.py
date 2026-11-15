from __future__ import annotations

import json
from pathlib import Path

from conftest import FIXTURES, REPO, component, copy_fixture, minimal_project, run_cli, write_files

from boundaries_kit.generate import generate
from boundaries_kit.index_file import INDEX_PATH, build_index
from boundaries_kit.manifest import load_project
from boundaries_kit.support import BUILTIN_PROTECTED


def test_builtin_protected_matches_the_schema_copy() -> None:
    canonical = json.loads((REPO / "schema" / "builtin-protected.json").read_text(encoding="utf-8"))
    assert list(BUILTIN_PROTECTED) == canonical


def test_index_shape_is_canonical(tmp_path: Path) -> None:
    body = '[protected]\npaths = ["src/app/web/a.py"]\n'
    files = minimal_project({".boundaries/web.toml": component(body=body), "src/app/web/a.py": ""})
    files[".boundaries/kit.toml"] += '\n[hook]\ndecision = "deny"\n\n[protected]\npaths = ["CLAUDE.md"]\n'
    files["CLAUDE.md"] = "# x\n"
    write_files(tmp_path, files)
    project = load_project(tmp_path)
    assert project.problems == []
    text = build_index(project)
    assert text.endswith("}\n")
    assert "\r" not in text
    data = json.loads(text)
    assert list(data) == ["decision", "protected", "schema_version"]
    assert data["decision"] == "deny"
    assert data["protected"] == sorted({*BUILTIN_PROTECTED, "CLAUDE.md", "src/app/web/a.py"})


def test_committed_fixture_indexes_are_fresh() -> None:
    for name in ("passing", "violating"):
        project = load_project(FIXTURES / name)
        assert [s.stale for s in generate(project, write=False)] == [False]


def test_generate_then_stale_gives_exit_4(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    index = root / INDEX_PATH
    index.unlink()
    r = run_cli("check", "--root", str(root))
    assert r.code == 4, r.stdout + r.stderr
    assert f"stale: {INDEX_PATH}" in r.stdout
    assert run_cli("generate", "--root", str(root)).stdout == f"wrote: {INDEX_PATH}\n"
    assert run_cli("generate", "--root", str(root)).stdout == f"unchanged: {INDEX_PATH}\n"
    assert run_cli("check", "--root", str(root)).code == 0
    index.write_bytes(index.read_bytes().replace(b"\n", b"\r\n"))
    assert run_cli("check", "--root", str(root)).code == 0, "CRLF checkouts are not stale"
    index.write_text('{"decision": "ask"}\n', encoding="utf-8")
    assert run_cli("check", "--root", str(root)).code == 4
