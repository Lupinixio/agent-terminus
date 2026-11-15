"""Checks of the Python adapter. Each returns violations; only the CLI picks exit codes."""

from __future__ import annotations


class ConfigError(Exception):
    """A check cannot run (missing provider, unparseable source): exit 3."""

    def __init__(self, file: str, key: str, message: str) -> None:
        super().__init__(message)
        self.file = file
        self.key = key
        self.message = message
