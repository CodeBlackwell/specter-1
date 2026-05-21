"""Telemetry sinks for the trust engine."""

from ..interfaces import Telemetry


class ListTelemetry(Telemetry):
    """In-memory telemetry sink. Each emit appends (event, fields) to .events."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    def emit(self, event: str, **fields: object) -> None:
        self.events.append((event, fields))
