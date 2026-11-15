"""Operator dashboard (Starlette). Routes are the ones declared in the manifest."""

import hmac
import logging

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from orders.clock import now
from orders.core import contract
from orders.dashboard.settings import api_token

log = logging.getLogger("orders.dashboard")


def _authorized(request: Request) -> bool:
    expected = f"Bearer {api_token()}"
    return hmac.compare_digest(request.headers.get("authorization", ""), expected)


async def index(request: Request) -> Response:
    return HTMLResponse("<h1>Orders</h1>")


async def status(request: Request) -> Response:
    return JSONResponse({**contract.status(), "at": now()})


async def pause(request: Request) -> Response:
    if not _authorized(request):
        log.warning("pause refused: bad credentials")
        return JSONResponse({"error": "forbidden"}, status_code=403)
    contract.set_paused(True)
    return JSONResponse({"paused": True})


async def resume(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    contract.set_paused(False)
    return JSONResponse({"paused": False})


async def cancel(request: Request) -> Response:
    if not _authorized(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    contract.cancel(request.path_params["id"])
    return JSONResponse({"cancelled": request.path_params["id"]})


app = Starlette(
    routes=[
        Route("/", index),
        Route("/api/status", status),
        Route("/api/pause", pause, methods=["POST"]),
        Route("/api/resume", resume, methods=["POST"]),
        Route("/api/orders/{id}/cancel", cancel, methods=["POST"]),
    ]
)
