"""pytest plugin (entry point ``boundaries_kit``): fixtures only, no collected tests.

- ``boundary_project``: the project loaded from the pytest rootdir.
- ``secret_sentinels``: a factory; ``secret_sentinels(["API_TOKEN"])`` plants fresh
  sentinels for the rest of the test and returns them. Restored at teardown.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator

import pytest

from .env import plant_env
from .manifest import Project, load_project
from .sentinels import make_sentinel


@pytest.fixture
def boundary_project(request: pytest.FixtureRequest) -> Project:
    return load_project(request.config.rootpath)


@pytest.fixture
def secret_sentinels() -> Iterator[Callable[[Iterable[str]], dict[str, str]]]:
    restores: list[Callable[[], None]] = []

    def plant(names: Iterable[str]) -> dict[str, str]:
        sentinels = {name: make_sentinel() for name in names}
        restores.append(plant_env(sentinels))
        return sentinels

    yield plant
    for restore in reversed(restores):
        restore()
