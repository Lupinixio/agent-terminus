"""The same dashboard with one violation of every kind the manifest limits."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from collections.abc import Callable

from badapp.clock import now
from badapp.core.contract import read_status, request_pause
from badapp.core.engine import flatten_all

from . import settings

log = logging.getLogger("badapp.dashboard")

Handler = Callable[[dict[str, str]], tuple[int, str]]


def _index(headers: dict[str, str]) -> tuple[int, str]:
    return 200, "<h1>Dashboard</h1>"


def _status(headers: dict[str, str]) -> tuple[int, str]:
    return 200, json.dumps({**read_status(), "at": now(), "pid": os.getpid()})


def _pause(headers: dict[str, str]) -> tuple[int, str]:
    token = settings.api_token()
    log.info("pause requested with token %s", token)
    if headers.get("authorization") != f"Bearer {token}":
        return 403, "forbidden"
    request_pause()
    return 202, "paused"


def _flatten(headers: dict[str, str]) -> tuple[int, str]:
    return 200, flatten_all()


ROUTES: dict[str, Handler] = {
    "GET /": _index,
    "GET /api/status": _status,
    "POST /api/pause": _pause,
    "POST /api/flatten": _flatten,
}


def handle(method: str, path: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
    route = ROUTES.get(f"{method} {path}")
    return route(headers or {}) if route else (404, "not found")


def dump_state() -> None:
    with open("state.json", "w") as f:
        f.write(json.dumps(read_status()))
    sqlite3.connect("state.db").close()


def export_yaml() -> str:
    import yaml

    return str(yaml.safe_dump(read_status()))
