"""Demo orchestration helpers — extracted from `examples/unified_demo.py`.

The demo is the showcase artifact (`just demo`); the workshop notebooks reuse
the same orchestration primitives so they exercise the real library, not a
parallel reimplementation.
"""

from specter.demo.orchestration import (
    LIE_OFFSET,
    SKEW_OFFSET_NS,
    SYBIL_LIE_RADIUS_M,
    RenderSnapshot,
    StreamTelemetry,
    SwarmState,
    apply_attack,
    build_swarm,
    make_bus,
    pub_bytes,
    snapshot,
    start_tour,
    step,
)

__all__ = [
    "LIE_OFFSET",
    "SKEW_OFFSET_NS",
    "SYBIL_LIE_RADIUS_M",
    "RenderSnapshot",
    "StreamTelemetry",
    "SwarmState",
    "apply_attack",
    "build_swarm",
    "make_bus",
    "pub_bytes",
    "snapshot",
    "start_tour",
    "step",
]
