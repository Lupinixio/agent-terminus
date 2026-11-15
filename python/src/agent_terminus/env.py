"""The only module of the Python adapter that touches the process environment.

The secrets probe needs it: it plants sentinel values under the declared secret
names, runs the probe, and restores the previous values.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping


def plant_env(values: Mapping[str, str]) -> Callable[[], None]:
    """Sets each name to its value; returns a function that restores the previous state."""
    previous = {name: os.environ.get(name) for name in values}
    os.environ.update(values)

    def restore() -> None:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    return restore
