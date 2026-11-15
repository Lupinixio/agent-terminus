from __future__ import annotations

from pathlib import Path

import pytest
from conftest import FIXTURES, component, minimal_project, write_files

from agent_terminus.checks import ConfigError
from agent_terminus.checks.imports import check_imports, classify, find_imports, module_name
from agent_terminus.manifest import load_project

IMPORTS = """[imports]
internal = ["app.clock", { target = "app.core.contract", only_from = ["app.web.handlers"] }]
external = ["starlette", { target = "uvicorn", only_from = ["app.web.server"] }]
builtin = ["json", "typing"]
"""


def _project(tmp_path: Path, sources: dict[str, str], body: str = IMPORTS) -> list[tuple[str, str | None, str]]:
    files = {f"src/app/web/{name}": code for name, code in sources.items()}
    write_files(tmp_path, minimal_project({".boundaries/web.toml": component(body=body), **files}))
    project = load_project(tmp_path)
    assert project.problems == []
    return [(v.key, v.location, v.message) for v in check_imports(project, project.manifests[0])]


def test_module_name() -> None:
    assert module_name("app.web", "server.py") == ("app.web.server", False)
    assert module_name("app.web", "__init__.py") == ("app.web", True)
    assert module_name("app.web", "api/__init__.py") == ("app.web.api", True)


def test_find_imports_resolves_relative_and_from_imports() -> None:
    code = "import a.b\nfrom . import x\nfrom ..core import y as z\nfrom __future__ import annotations\n"
    found = list(find_imports(code, "app.web.server", False))
    assert [f.candidates for f in found] == [("a.b",), ("app.web.x", "app.web"), ("app.core.y", "app.core")]
    assert [f.line for f in found] == [1, 2, 3]


def test_relative_import_beyond_top_is_an_error() -> None:
    with pytest.raises(ValueError, match="beyond"):
        list(find_imports("from ... import x\n", "app.web", True))


def test_classify() -> None:
    roots = frozenset({"app"})
    assert classify("app.core", roots) == "internal"
    assert classify("json", roots) == "builtin"
    assert classify("os.path", roots) == "builtin"
    assert classify("starlette.routing", roots) == "external"


def test_allowed_imports_pass(tmp_path: Path) -> None:
    sources = {
        "__init__.py": "",
        "handlers.py": "from app.core.contract import read\nfrom app import clock\nimport json\n",
        "server.py": (
            "import uvicorn\nfrom starlette.routing import Route\nfrom . import handlers\nfrom .handlers import x\n"
        ),
        "typed.py": "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from app.clock import now\n",
    }
    assert _project(tmp_path, sources) == []


def test_each_kind_of_violation(tmp_path: Path) -> None:
    sources = {
        "__init__.py": "",
        "bad.py": (
            "import sqlite3\n"
            "import requests\n"
            "from app.core import engine\n"
            "from app.core.contract import read\n"
            "import uvicorn\n"
            "from typing import TYPE_CHECKING\n"
            "if TYPE_CHECKING:\n"
            "    import app.core.engine\n"
            "def f():\n"
            "    import subprocess\n"
        ),
    }
    assert _project(tmp_path, sources) == [
        ("imports.builtin", "src/app/web/bad.py:1", "import sqlite3 is not allowed by imports.builtin"),
        ("imports.external", "src/app/web/bad.py:2", "import requests is not allowed by imports.external"),
        ("imports.internal", "src/app/web/bad.py:3", "from app.core import engine is not allowed by imports.internal"),
        (
            "imports.internal",
            "src/app/web/bad.py:4",
            "from app.core.contract import read: imports.internal allows app.core.contract only from app.web.handlers",
        ),
        (
            "imports.external",
            "src/app/web/bad.py:5",
            "import uvicorn: imports.external allows uvicorn only from app.web.server",
        ),
        ("imports.internal", "src/app/web/bad.py:8", "import app.core.engine is not allowed by imports.internal"),
        ("imports.builtin", "src/app/web/bad.py:10", "import subprocess is not allowed by imports.builtin"),
    ]


def test_any_and_exclude(tmp_path: Path) -> None:
    manifest = component(body=IMPORTS.replace('builtin = ["json", "typing"]', 'builtin = "any"')).replace(
        "decisions =", 'exclude = ["src/app/web/tests/**"]\ndecisions ='
    )
    files = {
        "src/app/web/a.py": "import sqlite3\nimport subprocess\n",
        "src/app/web/tests/test_a.py": "import pytest\n",
    }
    write_files(tmp_path, minimal_project({".boundaries/web.toml": manifest, **files}))
    project = load_project(tmp_path)
    assert project.problems == []
    assert check_imports(project, project.manifests[0]) == []


def test_unparseable_source_is_a_config_error(tmp_path: Path) -> None:
    write_files(
        tmp_path, minimal_project({".boundaries/web.toml": component(body=IMPORTS), "src/app/web/a.py": "def (:\n"})
    )
    project = load_project(tmp_path)
    with pytest.raises(ConfigError, match="cannot parse"):
        check_imports(project, project.manifests[0])


def test_fixtures() -> None:
    passing = load_project(FIXTURES / "passing")
    assert check_imports(passing, passing.manifests[0]) == []
    violating = load_project(FIXTURES / "violating")
    keys = sorted(v.key for v in check_imports(violating, violating.manifests[0]))
    assert keys == ["imports.builtin", "imports.builtin", "imports.external", "imports.internal"]
