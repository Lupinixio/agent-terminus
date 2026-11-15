"""A tiny operator dashboard: a route table, no web framework."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable

from okapp.clock import now
from okapp.core.contract import read_status, request_pause

from . import settings

log = logging.getLogger("okapp.dashboard")

Handler = Callable[[dict[str, str]], tuple[int, str]]


def _index(headers: dict[str, str]) -> tuple[int, str]:
    return 200, "<h1>Dashboard</h1>"


def _status(headers: dict[str, str]) -> tuple[int, str]:
    return 200, json.dumps({**read_status(), "at": now()})


def _pause(headers: dict[str, str]) -> tuple[int, str]:
    if headers.get("authorization") != f"Bearer {settings.api_token()}":
        log.warning("pause refused: bad credentials")
        return 403, "forbidden"
    request_pause()
    log.info("pause requested")
    return 202, "paused"


ROUTES: dict[str, Handler] = {
    "GET /": _index,
    "GET /api/status": _status,
    "POST /api/pause": _pause,
}


def handle(method: str, path: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
    route = ROUTES.get(f"{method} {path}")
    return route(headers or {}) if route else (404, "not found")
