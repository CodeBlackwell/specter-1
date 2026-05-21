"""Telemetry sinks. Drop-in `Telemetry` ABC implementations.

`JsonlTelemetrySink` appends one JSON object per `emit()` to a file path,
giving operators a persistent log that survives process restarts. Bytes
and other non-JSON-native fields are stringified — never raised — so the
sink doesn't crash a live agent on a malformed payload.
"""

import json
import time
from pathlib import Path

from ..interfaces import Telemetry


class JsonlTelemetrySink(Telemetry):
    """Appends one JSON object per emit() to `path`. Each line carries the
    event topic, all kwarg fields, and an injected wall_clock_ns timestamp.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event: str, **fields: object) -> None:
        record: dict[str, object] = {"event": event, "wall_clock_ns": time.time_ns()}
        record.update(fields)
        line = json.dumps(record, default=_jsonable, separators=(",", ":"))
        with self._path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def _jsonable(value: object) -> object:
    if isinstance(value, bytes):
        return value.hex()
    return repr(value)
