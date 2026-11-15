"""Providers for .boundaries/dashboard.toml. Protected (see [protected]).

They read the framework's real registry and settings; a hand-written list here
would make the check meaningless.
"""

from starlette.routing import Route
from starlette.testclient import TestClient

from orders.dashboard.app import app
from orders.dashboard.settings import api_token, settings


def http_routes() -> list[str]:
    """Every "METHOD /path" the app serves (HEAD is implied by GET)."""
    out = []
    for route in app.routes:
        if isinstance(route, Route):
            out += [f"{method} {route.path}" for method in sorted(route.methods or ()) if method != "HEAD"]
    return out


def bind_hosts() -> list[str]:
    return [settings.host]


def secret_probe() -> list[str]:
    """Calls every route with valid and invalid credentials; returns what a client sees.

    `boundaries check` plants a sentinel token first and searches the returned
    text, stdout, stderr and logs for it.
    """
    client = TestClient(app)
    seen = []
    for credentials in (f"Bearer {api_token()}", "Bearer wrong"):
        for line in http_routes():
            method, path = line.split(" ", 1)
            response = client.request(method, path.replace("{id}", "42"), headers={"authorization": credentials})
            seen.append(f"{line} -> {response.status_code} {dict(response.headers)} {response.text}")
    return seen
