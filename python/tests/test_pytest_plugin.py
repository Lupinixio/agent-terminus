from __future__ import annotations

import shutil

import pytest
from conftest import FIXTURES


def test_fixtures_are_registered(pytester: pytest.Pytester) -> None:
    shutil.copytree(FIXTURES / "passing", pytester.path, dirs_exist_ok=True)
    pytester.makepyfile(
        test_boundaries="""
        from agent_terminus.testing import assert_no_secret

        def test_project(boundary_project):
            assert [m.component.name for m in boundary_project.manifests] == ["dashboard"]
            assert boundary_project.problems == []

        def test_sentinels(secret_sentinels):
            sentinels = secret_sentinels(["OKAPP_API_TOKEN"])
            assert sentinels["OKAPP_API_TOKEN"].startswith("bk_")
            assert_no_secret(["clean"], sentinels)
        """
    )
    result = pytester.runpytest("-p", "no:cacheprovider")
    result.assert_outcomes(passed=2)


def test_plugin_collects_no_tests_of_its_own(pytester: pytest.Pytester) -> None:
    pytester.makepyfile("def test_one():\n    pass\n")
    pytester.runpytest().assert_outcomes(passed=1)
