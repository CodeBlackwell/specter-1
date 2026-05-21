"""Phase 1 wire payloads. Schema mirrors src/specter/proto/messages.proto.

Encoded as canonical JSON (sorted keys, no whitespace) so signatures verify
byte-for-byte across senders and runs. Phase 03 swaps in protoc-generated
bytes against the same .proto schema (ADR 0003).
"""

import json
from dataclasses import asdict, dataclass
from typing import Any

KIND_POSE = "pose_report"
KIND_OBSERVATION = "observation"
KIND_REPUTATION = "reputation_gossip"
KIND_FRAGMENT = "map_fragment"
KIND_LANDMARK_OBSERVATION = "landmark_observation"
KIND_CONTACT_REPORT = "contact_report"


@dataclass(frozen=True)
class PoseReport:
    agent_id: str
    x: float
    y: float
    theta: float
    timestamp_ns: int


@dataclass(frozen=True)
class Observation:
    """One beacon return on the wire. `range_m` is the measured scalar distance
    observer → subject; `bearing_rad` is the observer's body-frame bearing of
    the subject (observer-local, not world-frame). Only `range_m` enters the
    trust path (frame-invariant); `bearing_rad` is kept for visualization and
    future range-and-bearing fusion. Replaces the world-frame `rel_x, rel_y`
    projection that mixed observer SLAM drift into trust voting (ADR 0015)."""

    observer_id: str
    subject_id: str
    range_m: float
    bearing_rad: float
    timestamp_ns: int


@dataclass(frozen=True)
class ReputationGossip:
    gossiper_id: str
    views: dict[str, list[float]]
    timestamp_ns: int


@dataclass(frozen=True)
class LandmarkObservation:
    """One agent-to-stationary-landmark observation. Used by the pose-graph SLAM
    layer (ADR 0016 §5) as a landmark factor. Range and bearing are observer
    body-frame measurements; the landmark's world position is jointly estimated
    by the optimizer. The `nlos` flag triggers the σ_r × NLOS_INFLATE inflation
    per ADR 0016 §5 when set; clean LOS measurements leave it False."""

    observer_id: str
    landmark_id: str
    range_m: float
    bearing_rad: float
    timestamp_ns: int
    nlos: bool = False


@dataclass(frozen=True)
class ContactReport:
    """One agent's claim that an item is at a given position. Distinguished
    from `LandmarkObservation` (range-bearing measurement to a known landmark)
    by carrying the reporter's *world-frame estimate* of the item — this is
    the input the trust-weighted Common Operating Picture (COP) aggregates.
    Per ADR 0019, honest peers within sensor radius emit one per visible
    item per tick; compromised peers may inject phantoms or suppress real
    items via a `MapAttack`. The `kind` field mirrors `Item.kind` so the
    operator's COP can route by category."""

    reporter_id: str
    contact_id: str
    kind: str
    x: float
    y: float
    timestamp_ns: int


_DECODER: dict[str, type] = {
    KIND_POSE: PoseReport,
    KIND_OBSERVATION: Observation,
    KIND_REPUTATION: ReputationGossip,
    KIND_LANDMARK_OBSERVATION: LandmarkObservation,
    KIND_CONTACT_REPORT: ContactReport,
}


def encode(obj: Any) -> bytes:
    return json.dumps(asdict(obj), sort_keys=True, separators=(",", ":")).encode()


def decode(kind: str, data: bytes) -> Any:
    cls = _DECODER[kind]
    return cls(**json.loads(data))
