"""Dashboard settings. The token is read when needed, never stored or printed."""

import os

HOST = "127.0.0.1"
PORT = 8080


def api_token() -> str:
    return os.environ.get("OKAPP_API_TOKEN", "")
