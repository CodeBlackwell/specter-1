"""ADR 0022 §6 — OccupancyMapMerger singleton cell defenses.

Mirrors the pose-graph treatment (`tests/test_pose_graph_singleton.py`):
cells observed by exactly one reporter get scaled by SINGLETON_INFO_SCALE,
and singleton cells whose first-seen tick is more than T_CORROBORATE
behind the current tick fade toward zero. Both opt-in; default behavior
is byte-exact unchanged.
"""

from __future__ import annotations

import math

from specter.slam.map_merger import OccupancyMapMerger, encode_fragment
from specter.slam.pose_graph import SINGLETON_INFO_SCALE, T_CORROBORATE, T_FADE
from specter.types import Pose, RangeMeasurement


def _scan(angle: float, distance: float) -> RangeMeasurement:
    return RangeMeasurement(angle=angle, distance=distance, t=0.0)


def _fragment_from(agent_id: str, x: float, y: float, theta: float,
                   scans: list[RangeMeasurement]) -> bytes:
    return encode_fragment(agent_id, Pose(x=x, y=y, theta=theta, t=0.0), scans)


def _decode_cells(grid_bytes: bytes) -> tuple[int, int, list[list[int]]]:
    import json
    g = json.loads(grid_bytes)
    return g["width"], g["height"], g["cells"]


def test_singleton_cap_default_off_preserves_parity():
    """Cap is opt-in: without enable_singleton_cap, the merger produces
    byte-identical output across two merge calls regardless of reporter
    cardinality."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    frag = _fragment_from("solo", 0.5, 2.0, 0.0,
                          [_scan(0.0, 1.0)])  # endpoint at (1.5, 2.0)
    a = merger.merge([frag])
    b = merger.merge([frag])
    assert a == b


def test_singleton_cap_scales_single_reporter_cells():
    """With cap on, the occupancy weight for a single-reporter cell is
    scaled to SINGLETON_INFO_SCALE. We can see this in the votes grid:
    the endpoint cell goes from full weight 1.0 to 0.3 weight."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    frag = _fragment_from("solo", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    _, occ, _ = merger.merge_with_votes([frag])
    # Endpoint at world (1.5, 2.0) → cell (7, 10) at res=0.2
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    assert abs(occ[end_i][end_j] - SINGLETON_INFO_SCALE) < 1.0e-9, (
        f"singleton cell occ={occ[end_i][end_j]} should equal SINGLETON_INFO_SCALE"
    )


def test_multi_reporter_cell_keeps_full_weight():
    """A cell hit by two different reporters' endpoints is not singleton →
    no cap, no fade. With unit per-peer weights, accumulated occ = 2.0."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    # Two fragments from different agents hitting the same endpoint
    frag_a = _fragment_from("alice", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    frag_b = _fragment_from("bob", 2.5, 2.0, math.pi, [_scan(0.0, 1.0)])
    _, occ, _ = merger.merge_with_votes([frag_a, frag_b])
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    assert occ[end_i][end_j] >= 1.9, (
        f"multi-reporter cell occ={occ[end_i][end_j]} should be ≈ 2.0 (no cap)"
    )


def test_singleton_fade_at_full_decay():
    """A singleton cell whose first-seen tick is T_CORROBORATE + T_FADE
    behind current tick fades to zero. The endpoint vote becomes 0.0."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    merger.enable_singleton_fade(True)
    merger.set_current_tick(0)
    frag = _fragment_from("solo", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    merger.merge([frag])  # first-seen at tick 0
    merger.set_current_tick(T_CORROBORATE + T_FADE + 10)
    _, occ, _ = merger.merge_with_votes([frag])
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    assert occ[end_i][end_j] < 1.0e-9, (
        f"fully-faded singleton occ={occ[end_i][end_j]} should be ≈ 0"
    )


def test_singleton_fade_half_decay():
    """Linear-ramp midpoint: at first-seen + T_CORROBORATE + T_FADE/2, the
    fade multiplier is 0.5, so effective occ ≈ 0.5 · SINGLETON_INFO_SCALE."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    merger.enable_singleton_fade(True)
    merger.set_current_tick(0)
    frag = _fragment_from("solo", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    merger.merge([frag])
    merger.set_current_tick(T_CORROBORATE + T_FADE // 2)
    _, occ, _ = merger.merge_with_votes([frag])
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    expected = 0.5 * SINGLETON_INFO_SCALE
    assert abs(occ[end_i][end_j] - expected) < 0.05, (
        f"half-fade occ={occ[end_i][end_j]} should ≈ {expected}"
    )


def test_second_reporter_lifts_cap_across_calls():
    """Cell is singleton in the first batch (capped). In a later batch a
    second reporter contributes to the same cell → cumulative reporter set
    has cardinality 2 → cap is removed and full weight returns."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    frag_a = _fragment_from("alice", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    _, occ1, _ = merger.merge_with_votes([frag_a])
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    assert abs(occ1[end_i][end_j] - SINGLETON_INFO_SCALE) < 1.0e-9, (
        "first batch should be capped"
    )

    frag_b = _fragment_from("bob", 2.5, 2.0, math.pi, [_scan(0.0, 1.0)])
    _, occ2, _ = merger.merge_with_votes([frag_b])
    # Cumulative reporter set is now {alice, bob}; bob's batch occ is full.
    assert occ2[end_i][end_j] >= 0.9, (
        f"second batch (after corroboration) occ={occ2[end_i][end_j]} should be full"
    )


def test_cell_reporters_accumulates_across_calls():
    """Across multiple merge calls the persistent reporter set grows; the
    accessor reflects the cumulative state for inspection."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.2)
    merger.enable_singleton_cap(True)
    frag_a = _fragment_from("alice", 0.5, 2.0, 0.0, [_scan(0.0, 1.0)])
    merger.merge([frag_a])
    frag_b = _fragment_from("bob", 2.5, 2.0, math.pi, [_scan(0.0, 1.0)])
    merger.merge([frag_b])
    end_i = int(1.5 / 0.2)
    end_j = int(2.0 / 0.2)
    reporters = merger.cell_reporters()[(end_i, end_j)]
    assert reporters == {"alice", "bob"}
