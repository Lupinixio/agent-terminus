"""The part of the core the dashboard may use."""

_paused = [False]
_cancelled: set[str] = set()


def status() -> dict[str, object]:
    return {"paused": _paused[0], "cancelled": sorted(_cancelled)}


def set_paused(paused: bool) -> None:
    _paused[0] = paused


def cancel(order_id: str) -> None:
    _cancelled.add(order_id)
