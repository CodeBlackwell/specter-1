"""Typed schema for `trust.anomaly` events.

Wraps the ad-hoc `Telemetry.emit("trust.anomaly", **fields)` payload that
`BetaTrustEvaluator` produces into an auditable, frozen dataclass that
downstream consumers can branch on without stringly-typed dict access.
"""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class AnomalyEvent:
    category: str
    sender_id: str
    nonce: int
    timestamp_ns: int
    detail: str

    @classmethod
    def from_emit_kwargs(cls, **fields: object) -> "AnomalyEvent":
        nonce = fields["nonce"]
        timestamp_ns = fields["timestamp_ns"]
        if not isinstance(nonce, int):
            raise TypeError(f"nonce must be int, got {type(nonce).__name__}")
        if not isinstance(timestamp_ns, int):
            raise TypeError(f"timestamp_ns must be int, got {type(timestamp_ns).__name__}")
        return cls(
            category=str(fields["category"]),
            sender_id=str(fields["sender_id"]),
            nonce=nonce,
            timestamp_ns=timestamp_ns,
            detail=str(fields["detail"]),
        )

    def to_emit_kwargs(self) -> dict[str, object]:
        return asdict(self)
