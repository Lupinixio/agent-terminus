"""The only part of the core the dashboard may use."""

_state = {"paused": False}


def read_status() -> dict[str, bool]:
    return dict(_state)


def request_pause() -> None:
    _state["paused"] = True
