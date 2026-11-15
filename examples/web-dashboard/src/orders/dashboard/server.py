import uvicorn

from orders.dashboard.app import app
from orders.dashboard.settings import settings


def main() -> None:
    uvicorn.run(app, host=settings.host, port=settings.port)
