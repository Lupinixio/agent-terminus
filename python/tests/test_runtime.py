from __future__ import annotations

import base64
import json
import logging
import sys
import urllib.parse
from pathlib import Path

import pytest
from conftest import FIXTURES, component, copy_fixture, minimal_project, write_files

from agent_terminus.checks import ConfigError
from agent_terminus.checks.runtime import capture_output, check_bind, check_secrets
from agent_terminus.manifest import load_project
from agent_terminus.sentinels import find_leaks, make_sentinel, sentinel_forms
from agent_terminus.testing import assert_no_secret, secret_sentinels


def test_bind_violating_fixture_binds_to_all_interfaces() -> None:
    project = load_project(FIXTURES / "violating")
    found = check_bind(project, project.manifests[0])
    assert [(v.check, v.key, v.message) for v in found] == [
        ("runtime.bind", "runtime.bind.hosts", "binds to 0.0.0.0, which is not in runtime.bind.hosts")
    ]
    passing = load_project(FIXTURES / "passing")
    assert check_bind(passing, passing.manifests[0]) == []


def test_bind_empty_provider_result_is_a_violation(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    boundary = root / "src" / "okapp" / "dashboard" / "boundary.py"
    boundary.write_text(
        boundary.read_text(encoding="utf-8").replace("return [settings.HOST]", "return []"), encoding="utf-8"
    )
    project = load_project(root)
    found = check_bind(project, project.manifests[0])
    assert "returned no host" in found[0].message


def test_sentinel_shape_and_forms() -> None:
    s = make_sentinel()
    assert s.startswith("bk_")
    assert len(s) == 35
    int(s[3:], 16)
    labels = {label for label, _ in sentinel_forms(s)}
    assert {"raw", "first half", "second half", "repr", "base64"} <= labels


def test_every_encoding_of_a_leak_is_found() -> None:
    s = make_sentinel()
    sentinels = {"API_TOKEN": s}
    leaks = [
        f"token={s}",
        f"prefix {s[3:19]} only",
        f"tail {s[19:]}",
        urllib.parse.quote(f"a={s}&b", safe=""),
        json.dumps({"t": s}),
        repr({"t": s}),
        base64.b64encode(f"Authorization: Basic user:{s}".encode()).decode(),
        base64.urlsafe_b64encode(f"x{s}".encode()).decode(),
        base64.b64encode(f"xy{s}yz".encode()).decode(),
    ]
    for text in leaks:
        assert len(find_leaks([("s", text)], sentinels)) == 1, text
    assert find_leaks([("s", "nothing here")], sentinels) == []


def test_capture_output_restores_everything() -> None:
    root = logging.getLogger()
    level = root.level
    handlers = list(root.handlers)
    stdout = sys.stdout
    with capture_output() as captured:
        print("to stdout")
        print("to stderr", file=sys.stderr)
        logging.getLogger("x.y").debug("a debug record")
    assert captured.stdout == "to stdout\n"
    assert captured.stderr == "to stderr\n"
    assert "DEBUG x.y a debug record" in captured.logs
    assert root.level == level
    assert root.handlers == handlers
    assert sys.stdout is stdout


def test_violating_fixture_logs_the_token() -> None:
    project = load_project(FIXTURES / "violating")
    found = check_secrets(project, project.manifests[0])
    assert [v.message for v in found] == ["secret BADAPP_API_TOKEN leaked in logging (raw)"]
    passing = load_project(FIXTURES / "passing")
    assert check_secrets(passing, passing.manifests[0]) == []


PROBE_BODY = """[runtime.secrets]
names = ["APP_TOKEN"]
probe = "app.web.boundary:probe"

[protected]
paths = ["src/app/web/boundary.py"]
"""


def _probe_project(root: Path, code: str) -> list[str]:
    write_files(
        root,
        minimal_project(
            {
                ".boundaries/web.toml": component(body=PROBE_BODY),
                "src/app/__init__.py": "",
                "src/app/web/__init__.py": "",
                "src/app/web/boundary.py": "import base64, os, sys\n\n" + code,
            }
        ),
    )
    project = load_project(root)
    assert project.problems == []
    return [v.message for v in check_secrets(project, project.manifests[0])]


def test_each_output_channel_is_searched(tmp_path: Path) -> None:
    token = "os.environ['APP_TOKEN']"
    cases = {
        "returned": (f"def probe():\n    return 'x' + {token}\n", "probe return value (raw)"),
        "printed": (f"def probe():\n    print({token}[3:19])\n", "stdout (first half)"),
        "stderr": (f"def probe():\n    print(repr({token}), file=sys.stderr)\n", "stderr (raw)"),
        "b64": (
            f"def probe():\n    return [base64.b64encode({token}.encode()).decode()]\n",
            "probe return value (base64)",
        ),
        "clean": ("def probe():\n    return ['nothing']\n", None),
    }
    for name, (code, expected) in cases.items():
        found = _probe_project(tmp_path / name, code)
        assert found == ([f"secret APP_TOKEN leaked in {expected}"] if expected else []), name


def test_failing_probe_is_a_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match=r"probe app.web.boundary:probe failed"):
        _probe_project(tmp_path, "def probe():\n    raise RuntimeError('boom')\n")


def test_secret_sentinels_and_assert_no_secret() -> None:
    with secret_sentinels(["A_TOKEN"]) as sentinels:
        s = sentinels["A_TOKEN"]
        assert_no_secret(["clean"], sentinels)
        with pytest.raises(AssertionError) as info:
            assert_no_secret([f"x {s}", "ok", base64.b64encode(s.encode()).decode()], sentinels)
    assert "text #0" in str(info.value)
    assert "text #2" in str(info.value)
