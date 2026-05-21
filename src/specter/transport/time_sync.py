"""Outer-filter envelope timestamp skew validation.

Sits in front of the existing replay-window check (`secure_bus.ReplayWindow`).
Replay-window enforces strict-monotonic per-sender nonces — this rule rejects
envelopes whose `timestamp_ns` disagrees with the receiver's wall clock by
more than `max_skew_ns`, regardless of nonce.

Default 5s threshold rationale: see `docs/adr/0008-time-sync-skew.md`.
"""

from ..secure_bus import VerificationError

DEFAULT_MAX_SKEW_NS = 5_000_000_000  # 5 seconds


def validate_timestamp(
    envelope_ts_ns: int,
    wall_clock_ns: int,
    max_skew_ns: int = DEFAULT_MAX_SKEW_NS,
) -> None:
    """Raise VerificationError when |envelope_ts - wall_clock| exceeds threshold.

    Categories embedded in the message: ``clock_skew_future`` when envelope
    is ahead of wall clock, ``clock_skew_past`` when behind.
    """
    skew = envelope_ts_ns - wall_clock_ns
    if skew > max_skew_ns:
        raise VerificationError(
            f"clock_skew_future: envelope {skew / 1e9:.3f}s ahead of wall clock"
        )
    if skew < -max_skew_ns:
        raise VerificationError(
            f"clock_skew_past: envelope {-skew / 1e9:.3f}s behind wall clock"
        )
