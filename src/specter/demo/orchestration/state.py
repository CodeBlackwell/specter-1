"""Constants, telemetry shim, and dataclasses for swarm state + render snapshot."""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field

from cryptography.hazmat.primitives import serialization

from specter.identity import (
    MockAttestationProvider,
    MutableRoster,
    RevocationList,
)
from specter.interfaces import MessageBus, Telemetry
from specter.secure_bus import Identity, ReplayWindow
from specter.sim.agent import Agent
from specter.sim.runner import Simulation, Tick
from specter.sim.world import Wall
from specter.slam import OccupancyMapMerger, ScanMatchSlam
from specter.telemetry import AnomalyEvent, JsonlTelemetrySink, ReputationTrace
from specter.trust import BetaTrustEvaluator, ListTelemetry
from specter.types import Pose, RangeMeasurement

# ── Demo behavior constants ────────────────────────────────────────────────
LIE_OFFSET: tuple[float, float] = (3.0, 3.0)
GRID_RES_M: float = 0.2
MERGE_INTERVAL_TICKS: int = 10
FRAGMENT_BUFFER_PER_AGENT: int = 4
LOOP_CLOSURE_FLASH_FRAMES: int = 12
SKEW_OFFSET_NS: int = 6_000_000_000
ANOMALY_PANEL_LINES: int = 8
SYBIL_LIE_RADIUS_M: float = 1.5
LOG_LINES: int = 22


class StreamTelemetry(Telemetry):
    """Tees `BetaTrustEvaluator.emit()` to an inner sink, an optional JSONL
    sink, and a bounded ring of typed `AnomalyEvent`s used by the demo's
    anomaly panel and the notebook anomaly visualizations.

    `collapsed` keys events by `(category, sender_id)` and counts repeats,
    preserving recency order (insertion-order dict; touched keys move to
    the end). Demo's verbose anomaly stream renders this with `× N`."""

    def __init__(self, inner: Telemetry, ring_size: int = ANOMALY_PANEL_LINES) -> None:
        self.inner = inner
        self.jsonl: JsonlTelemetrySink | None = None
        self.recent: deque[AnomalyEvent] = deque(maxlen=ring_size)
        self.collapsed: dict[tuple[str, str], tuple[AnomalyEvent, int]] = {}
        self._collapsed_max = ring_size

    def emit(self, event: str, **fields: object) -> None:
        self.inner.emit(event, **fields)
        if self.jsonl is not None:
            self.jsonl.emit(event, **fields)
        if event == "trust.anomaly":
            try:
                ev = AnomalyEvent.from_emit_kwargs(**fields)
            except (KeyError, TypeError, ValueError):
                return
            self.recent.append(ev)
            key = (ev.category, ev.sender_id)
            prev_count = self.collapsed.get(key, (ev, 0))[1]
            self.collapsed.pop(key, None)
            self.collapsed[key] = (ev, prev_count + 1)
            while len(self.collapsed) > self._collapsed_max:
                self.collapsed.pop(next(iter(self.collapsed)))


def pub_bytes(pub) -> bytes:  # type: ignore[no-untyped-def]
    """Canonical X9.62 uncompressed-point bytes for an EC public key.

    Mirrors `Sros2Bus._apply_filters` so revocation/attestation lookups key
    on the same bytes regardless of bus.
    """
    raw: bytes = pub.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return raw


@dataclass
class SwarmState:
    """Mutable holder for one demo/notebook session.

    Constructed by `build_swarm()`. `step()` advances and mutates fields
    in place. `apply_attack()` injects Byzantine behavior. `snapshot()`
    reads a frame view without mutation.
    """

    sim: Simulation
    bus: MessageBus
    bus_label: str
    primary_id: str
    agent_ids: list[str]
    identities: dict[str, Identity]
    roster: MutableRoster
    revocation: RevocationList
    attestation: MockAttestationProvider
    list_telemetry: ListTelemetry
    telemetry: StreamTelemetry
    agent_evaluators: dict[str, BetaTrustEvaluator]
    agent_replays: dict[str, ReplayWindow]
    rep_traces: dict[str, ReputationTrace]
    slam: dict[str, ScanMatchSlam]
    mergers: dict[str, OccupancyMapMerger]
    fragment_buffers: dict[str, deque[bytes]]
    merged_grids: dict[str, bytes | None]
    loop_closure_flash: dict[str, int]
    log: deque[tuple[str, str, int]]
    rng: random.Random
    attestation_required: bool = False
    clock_skew_offsets: dict[str, int] = field(default_factory=dict)
    sybils: dict[str, Identity] = field(default_factory=dict)
    sybil_targets: dict[str, str] = field(default_factory=dict)
    compromised: set[str] = field(default_factory=set)
    liars: set[str] = field(default_factory=set)
    last_tick: Tick | None = None
    tick_count: int = 0
    last_merge_tick: int = 0
    viewer_id: str = ""
    last_reject_tick: dict[str, int] = field(default_factory=dict)
    sybil_last_pose: dict[str, tuple[float, float]] = field(default_factory=dict)
    merged_votes_for_viewer: list[list[float]] | None = None
    tour_active: bool = False
    tour_start_tick: int = 0
    tour_step_idx: int = 0
    tour_toast: str = ""
    tour_toast_until_tick: int = 0
    action_history: list[tuple[float, str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class RenderSnapshot:
    """Read-only frame view consumed by renderers (pygame demo, matplotlib
    notebook helpers). Built by `snapshot(state)`.
    """

    tick_count: int
    sim_t: float
    world_width: float
    world_height: float
    agents: tuple[Agent, ...]
    walls: tuple[Wall, ...]
    scans: dict[str, tuple[RangeMeasurement, ...]]
    slam_poses: dict[str, Pose]
    slam_drift: dict[str, float]
    bad_agents: frozenset[str]
    lying_agents: frozenset[str]
    viewer_id: str
    viewer_reputation: dict[str, float]
    viewer_presence: dict[str, bool]
    viewer_alpha_beta: dict[str, tuple[float, float]]
    merged_grid_bytes: bytes | None
    loop_closure_active: bool
    last_merge_tick: int
    bus_label: str
    attestation_required: bool
    sybil_claim_pose: dict[str, tuple[float, float]]
    sybil_targets: dict[str, str]
    last_reject_tick: dict[str, int]
    merged_votes: list[list[float]] | None
    tour_active: bool
    tour_toast: str
