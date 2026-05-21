"""Orchestration primitives for the unified demo + workshop notebooks.

`build_swarm()` constructs the full hardened pipeline (identities, roster,
revocation, attestation, evaluators, replay windows, SLAM, mergers, bus,
telemetry). `step()` advances one sim tick (sense → SLAM → publish →
receive → trust update). `apply_attack()` mutates state to inject Byzantine
behavior. `snapshot()` returns a serializable view for rendering.

Originally a single module; split into submodules. Flat re-export surface
preserves call sites: `from specter.demo.orchestration import X`.
"""

from .attacks import apply_attack
from .build import build_swarm, make_bus
from .snapshot import snapshot
from .state import (
    ANOMALY_PANEL_LINES,
    FRAGMENT_BUFFER_PER_AGENT,
    GRID_RES_M,
    LIE_OFFSET,
    LOG_LINES,
    LOOP_CLOSURE_FLASH_FRAMES,
    MERGE_INTERVAL_TICKS,
    SKEW_OFFSET_NS,
    SYBIL_LIE_RADIUS_M,
    RenderSnapshot,
    StreamTelemetry,
    SwarmState,
    pub_bytes,
)
from .step import TOUR_SCRIPT, start_tour, step

__all__ = [
    "ANOMALY_PANEL_LINES",
    "FRAGMENT_BUFFER_PER_AGENT",
    "GRID_RES_M",
    "LIE_OFFSET",
    "LOG_LINES",
    "LOOP_CLOSURE_FLASH_FRAMES",
    "MERGE_INTERVAL_TICKS",
    "RenderSnapshot",
    "SKEW_OFFSET_NS",
    "SYBIL_LIE_RADIUS_M",
    "StreamTelemetry",
    "SwarmState",
    "TOUR_SCRIPT",
    "apply_attack",
    "build_swarm",
    "make_bus",
    "pub_bytes",
    "snapshot",
    "start_tour",
    "step",
]
