"""Per-topic QoS profile selection for `Sros2Bus`.

Each ROS2 topic in the specter-1 envelope set has different freshness vs
delivery semantics. A blanket reliability/depth choice either over-protects
sensor flows (latency cost) or under-protects gossip (correctness cost). This
module is the single point that maps a topic name to the right QoS profile.

Topic taxonomy
--------------

- ``pose``        — agent self-pose. Per-tick, latest wins, history depth 1,
                    BEST_EFFORT, lifespan one publish interval (~50ms at
                    20Hz). Late samples are stale and unwanted.
- ``observation`` — peer beacon/UWB observations. Per-tick burst, all matter
                    (cohort voting needs a full cohort), KEEP_LAST 20,
                    RELIABLE, lifespan one tick window (~100ms). Drops would
                    bias the geometric median.
- ``reputation``  — gossip snapshots. Asynchronous, eventually-consistent,
                    KEEP_LAST 10, RELIABLE, lifespan 1s. Loss directly costs
                    convergence speed of trust state across the swarm.
- ``beacon``      — raw UWB beacon ranges (when published as standalone
                    topic; subsumed by ``observation`` in current eval).
                    Same shape as ``pose`` — latest wins, BEST_EFFORT.

Default fallback profile (for unknown topics): RELIABLE, KEEP_LAST 10, no
lifespan — the conservative choice that mirrors `Sros2Bus`'s pre-QoS
behavior.

Use
---

`qos_for_topic(topic: str) -> QoSProfile` returns a `QoSProfile` for the
given topic. `Sros2Bus` accepts an optional `qos_for_topic` callable; when
provided, publishers and subscribers use the topic-specific profile. When
omitted, the bus falls back to its previous queue-depth-only behavior so
existing call sites are unaffected.

`QoSProfile` is a small dataclass capturing the fields that matter to us;
`to_rclpy(profile)` materializes a real `rclpy.qos.QoSProfile` when rclpy is
installed. Tests that don't have rclpy can still introspect the dataclass.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

try:
    from rclpy.qos import (  # type: ignore[import-not-found,unused-ignore]
        DurabilityPolicy as _DurabilityPolicy,
    )
    from rclpy.qos import (
        HistoryPolicy as _HistoryPolicy,
    )
    from rclpy.qos import (
        QoSProfile as _RclpyQoSProfile,
    )
    from rclpy.qos import (
        ReliabilityPolicy as _ReliabilityPolicy,
    )

    _RCLPY_QOS_AVAILABLE = True
except ImportError:
    _RclpyQoSProfile = None  # type: ignore[assignment,misc,unused-ignore]
    _ReliabilityPolicy = None  # type: ignore[assignment,misc,unused-ignore]
    _HistoryPolicy = None  # type: ignore[assignment,misc,unused-ignore]
    _DurabilityPolicy = None  # type: ignore[assignment,misc,unused-ignore]
    _RCLPY_QOS_AVAILABLE = False


class Reliability(Enum):
    BEST_EFFORT = "best_effort"
    RELIABLE = "reliable"


class History(Enum):
    KEEP_LAST = "keep_last"
    KEEP_ALL = "keep_all"


@dataclass(frozen=True)
class QoSProfile:
    """Transport-agnostic QoS profile.

    `lifespan_ns=0` means "no lifespan" (envelopes never expire on the
    publisher side). All other values are nanoseconds.
    """

    reliability: Reliability
    history: History
    depth: int
    lifespan_ns: int = 0


# 50 ms at 20 Hz sim tick rate; matches one publish interval.
_TICK_NS = 50_000_000

_POSE_PROFILE = QoSProfile(
    reliability=Reliability.BEST_EFFORT,
    history=History.KEEP_LAST,
    depth=1,
    lifespan_ns=_TICK_NS,
)

_OBSERVATION_PROFILE = QoSProfile(
    reliability=Reliability.RELIABLE,
    history=History.KEEP_LAST,
    depth=20,
    lifespan_ns=2 * _TICK_NS,
)

_REPUTATION_PROFILE = QoSProfile(
    reliability=Reliability.RELIABLE,
    history=History.KEEP_LAST,
    depth=10,
    lifespan_ns=1_000_000_000,
)

_BEACON_PROFILE = QoSProfile(
    reliability=Reliability.BEST_EFFORT,
    history=History.KEEP_LAST,
    depth=1,
    lifespan_ns=_TICK_NS,
)

_DEFAULT_PROFILE = QoSProfile(
    reliability=Reliability.RELIABLE,
    history=History.KEEP_LAST,
    depth=10,
    lifespan_ns=0,
)

_TOPIC_TABLE: dict[str, QoSProfile] = {
    "pose": _POSE_PROFILE,
    "observation": _OBSERVATION_PROFILE,
    "reputation": _REPUTATION_PROFILE,
    "beacon": _BEACON_PROFILE,
}


def qos_for_topic(topic: str) -> QoSProfile:
    """Return the QoS profile for `topic`.

    Falls back to a conservative RELIABLE / KEEP_LAST(10) profile for any
    topic outside the known taxonomy.
    """
    return _TOPIC_TABLE.get(topic, _DEFAULT_PROFILE)


def to_rclpy(profile: QoSProfile) -> Any:
    """Convert a `QoSProfile` to an `rclpy.qos.QoSProfile`.

    Raises `RuntimeError` when rclpy is not installed — call sites should
    only invoke this when rclpy is available (typically inside `Sros2Bus`,
    which already requires rclpy).
    """
    if not _RCLPY_QOS_AVAILABLE:
        raise RuntimeError("rclpy is not installed; cannot materialize rclpy QoSProfile")
    reliability = (
        _ReliabilityPolicy.RELIABLE
        if profile.reliability is Reliability.RELIABLE
        else _ReliabilityPolicy.BEST_EFFORT
    )
    history = (
        _HistoryPolicy.KEEP_ALL
        if profile.history is History.KEEP_ALL
        else _HistoryPolicy.KEEP_LAST
    )
    return _RclpyQoSProfile(
        reliability=reliability,
        history=history,
        depth=profile.depth,
    )
