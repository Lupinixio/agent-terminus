"""Providers for .boundaries/dashboard.toml. Protected: they must read the real
route table and settings, never a hand-written list."""

from okapp.dashboard import settings
from okapp.dashboard.app import ROUTES, handle


def http_routes() -> list[str]:
    return list(ROUTES)


def bind_hosts() -> list[str]:
    return [settings.HOST]


def secret_probe() -> list[str]:
    """Drives every route with valid and invalid credentials; returns what a client sees."""
    seen = []
    for credentials in (f"Bearer {settings.api_token()}", "Bearer wrong"):
        for route in ROUTES:
            method, path = route.split(" ", 1)
            status, body = handle(method, path, {"authorization": credentials})
            seen.append(f"{route} -> {status} {body}")
    return seen
