"""Dashboard settings. The token is read when needed, never stored or printed."""

import os

HOST = "0.0.0.0"
PORT = 8080


def api_token() -> str:
    return os.environ.get("BADAPP_API_TOKEN", "")
