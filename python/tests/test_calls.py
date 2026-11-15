from __future__ import annotations

from pathlib import Path

import pytest
from conftest import FIXTURES, component, minimal_project, write_files

from agent_terminus.checks import ConfigError
from agent_terminus.checks.calls import check_calls, find_calls, match_call
from agent_terminus.manifest import load_project


def _names(code: str) -> list[str]:
    return [c.name for c in find_calls(code, "app.web.mod")]


def test_aliases_resolve_to_dotted_names() -> None:
    code = (
        "import subprocess as sp\n"
        "from os import system as s\n"
        "import os.path\n"
        "from . import helpers\n"
        "sp.run(['x'])\n"
        "s('x')\n"
        "os.path.join('a')\n"
        "helpers.go()\n"
    )
    assert _names(code) == ["subprocess.run", "os.system", "os.path.join", "app.web.helpers.go"]


def test_bare_names_and_builtins() -> None:
    assert _names("open('x')\n") == ["open"]
    assert _names("import builtins\nbuiltins.open('x')\n") == ["open"]
    assert _names("from os import open\nopen('x', 0)\n") == ["os.open"]


def test_match_call() -> None:
    assert match_call("open", ("open",), True)
    assert not match_call("open", ("os", "open"), True)
    assert match_call("*.open", ("os", "open"), True)
    assert match_call("*.open", ("<expression>", "open"), False)
    assert not match_call("*.open", ("open",), True)
    assert match_call("subprocess.*", ("subprocess", "run"), True)
    assert not match_call("subprocess.*", ("subprocess", "run", "x"), True)
    assert match_call("fs.write*", ("fs", "writeFile"), True)
    assert not match_call("x.run", ("<expression>", "run"), False)


def test_check_reports_location_and_reason(tmp_path: Path) -> None:
    body = '[calls]\nforbidden = ["open", "*.open", { pattern = "subprocess.*", reason = "no processes" }]\n'
    code = "import subprocess as sp\nimport io\n\nsp.run([])\nio.open('x')\nopen('y')\nprint('ok')\n"
    write_files(tmp_path, minimal_project({".boundaries/web.toml": component(body=body), "src/app/web/a.py": code}))
    project = load_project(tmp_path)
    found = [(v.location, v.message) for v in check_calls(project, project.manifests[0])]
    assert found == [
        ("src/app/web/a.py:4", "call to subprocess.run matches forbidden pattern subprocess.* (no processes)"),
        ("src/app/web/a.py:5", "call to io.open matches forbidden pattern *.open"),
        ("src/app/web/a.py:6", "call to open matches forbidden pattern open"),
    ]


def test_unparseable_source_is_a_config_error(tmp_path: Path) -> None:
    body = '[calls]\nforbidden = ["open"]\n'
    write_files(
        tmp_path, minimal_project({".boundaries/web.toml": component(body=body), "src/app/web/a.py": "x = (\n"})
    )
    project = load_project(tmp_path)
    with pytest.raises(ConfigError):
        check_calls(project, project.manifests[0])


def test_fixtures() -> None:
    passing = load_project(FIXTURES / "passing")
    assert check_calls(passing, passing.manifests[0]) == []
    violating = load_project(FIXTURES / "violating")
    messages = [v.message for v in check_calls(violating, violating.manifests[0])]
    assert len(messages) == 2
    assert "call to open" in messages[0]
    assert "sqlite3.connect" in messages[1]
