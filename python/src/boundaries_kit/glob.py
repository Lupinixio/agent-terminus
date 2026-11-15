"""Pure glob matching shared by every adapter (cases in schema/fixtures/globs.json).

Supported syntax: ``*`` (within a segment), ``?`` (one character), ``**`` (any number
of whole segments). Paths use forward slashes and are relative to the project root.
"""

from __future__ import annotations

import re
import sys

_SPECIAL = set(".+^${}()|[]\\")


def _escape(ch: str) -> str:
    return "\\" + ch if ch in _SPECIAL else ch


def _segment_source(segment: str) -> str:
    out = []
    for ch in segment:
        if ch == "*":
            out.append("[^/]*")
        elif ch == "?":
            out.append("[^/]")
        else:
            out.append(_escape(ch))
    return "".join(out)


def glob_source(glob: str) -> str:
    """Regular-expression source (without anchors) for a glob."""
    segments = glob.replace("\\", "/").split("/")
    out = ""
    for i, segment in enumerate(segments):
        last = i == len(segments) - 1
        if segment == "**":
            if len(segments) == 1:
                out += ".*"
            elif i == 0:
                out += "(?:.*/)?"
            elif last:
                out += "/.+"
            else:
                out += "/(?:.*/)?"
        else:
            if i > 0 and segments[i - 1] != "**":
                out += "/"
            out += _segment_source(segment)
    return out


def match(glob: str, relpath: str, *, nocase: bool | None = None) -> bool:
    """Whether a project-relative path matches a glob (case-insensitive on Windows)."""
    if nocase is None:
        nocase = sys.platform == "win32"
    flags = re.IGNORECASE if nocase else 0
    return re.fullmatch(glob_source(glob), relpath.replace("\\", "/"), flags) is not None


def has_glob_chars(text: str) -> bool:
    return "*" in text or "?" in text


def literal_prefix(glob: str) -> str:
    """The literal text before the first glob character."""
    for i, ch in enumerate(glob):
        if ch in "*?":
            return glob[:i]
    return glob
