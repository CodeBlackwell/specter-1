"""Smoke tests for `specter.viz.notebook` — every helper produces a Figure
under `MPLBACKEND=Agg`. Interaction correctness (ipywidgets sliders, animation
playback) is validated by manual notebook execution; CI just gates that the
helpers don't raise.
"""

import os

import matplotlib
import pytest

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from specter.demo import build_swarm, snapshot, step
from specter.slam import OccupancyMapMerger, ScanMatchSlam, encode_fragment
from specter.telemetry import ReputationTrace
from specter.trust import CohortEvent
from specter.types import IMUSample, Pose, RangeMeasurement
from specter.viz.notebook import (
    beta_pdf,
    cohort_timeline,
    decay_trajectory,
    merge_side_by_side,
    merge_three_panel,
    radial_flow_diagram,
    rep_smallmultiples,
    reputation_sparkline,
    slam_trajectory_overlay,
    triangulation_2d,
    world_animation,
    world_figure,
)

os.environ.setdefault("MPLBACKEND", "Agg")


@pytest.fixture
def small_state():
    return build_swarm("scenarios/two_agents.yaml")


def test_world_figure_returns_figure(small_state):
    step(small_state)
    snap = snapshot(small_state)
    fig = world_figure(snap)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_world_animation_returns_animation(small_state):
    snaps = []
    for _ in range(3):
        step(small_state)
        snaps.append(snapshot(small_state))
    anim = world_animation(snaps, interval_ms=50)
    assert anim is not None
    plt.close(anim._fig)


def test_beta_pdf_returns_figure():
    fig = beta_pdf(2.0, 1.0)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_decay_trajectory_with_data():
    trace = ReputationTrace()
    for i in range(10):
        trace.record("alpha", 1.0 + i * 0.5, 1.0, i * 1_000_000_000)
    fig = decay_trajectory(trace, "alpha")
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_decay_trajectory_empty():
    fig = decay_trajectory(ReputationTrace(), "ghost")
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_reputation_sparkline():
    trace = ReputationTrace()
    for peer in ("a", "b"):
        for i in range(5):
            trace.record(peer, 1.0 + i, 1.0, i * 1_000_000_000)
    fig = reputation_sparkline(trace, ["a", "b"])
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_cohort_timeline():
    events = [
        CohortEvent("alpha", 1_000_000_000, 3, fired=True, tier_used="t1", median_range_m=2.0, embeddability_score=None),
        CohortEvent("alpha", 2_000_000_000, 2, fired=False, tier_used="skip", median_range_m=None, embeddability_score=None),
        CohortEvent("bravo", 1_500_000_000, 4, fired=True, tier_used="t1", median_range_m=3.5, embeddability_score=None),
    ]
    fig = cohort_timeline(events)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_cohort_timeline_empty():
    fig = cohort_timeline([])
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_triangulation_2d():
    # ADR 0015: pending_cohorts now yields (observer, range_m) pairs.
    pending = {
        ("alpha", 1_000_000_000): [
            ("o1", 1.4),
            ("o2", 1.5),
            ("o3", 1.45),
        ]
    }
    positions = {"o1": (0.0, 0.0), "o2": (2.0, 0.0), "o3": (1.0, 1.5)}
    fig = triangulation_2d(pending, observer_positions=positions)
    assert isinstance(fig, Figure)
    plt.close(fig)
    # Also exercise the positions-omitted path.
    fig2 = triangulation_2d(pending)
    assert isinstance(fig2, Figure)
    plt.close(fig2)


def test_slam_trajectory_overlay():
    truth = [(float(i), 0.0) for i in range(10)]
    dr = [(float(i), 0.1 * i) for i in range(10)]
    scan = [(float(i), 0.01 * i) for i in range(10)]
    fig = slam_trajectory_overlay(truth, dr=dr, scan=scan)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_radial_flow_diagram():
    slam = ScanMatchSlam(
        agent_id="a",
        init_pose=Pose(x=0.0, y=0.0, theta=0.0, t=0.0),
        dt=0.1,
        record_pairs=True,
    )
    imu = IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.0)
    scan_a = [RangeMeasurement(angle=0.0, distance=2.0, t=0.0)]
    scan_b = [RangeMeasurement(angle=0.0, distance=1.9, t=0.1)]
    slam.update(scan_a, imu)
    slam.update(scan_b, IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.1))
    pairs = slam.matched_pairs()
    fig = radial_flow_diagram(pairs, pose=slam.pose())
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_radial_flow_empty():
    fig = radial_flow_diagram([], pose=None)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_merge_three_panel():
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.5)
    pose = Pose(x=1.0, y=1.0, theta=0.0, t=0.0)
    scan = [RangeMeasurement(angle=0.0, distance=1.5, t=0.0)]
    fragment = encode_fragment("alpha", pose, scan)
    binary, occ, free = merger.merge_with_votes([fragment])
    bin_grid = np.frombuffer(binary, dtype="uint8")  # not real shape — just exercise call
    # Use the cells from JSON for the actual binary visualization
    import json
    cells = json.loads(binary)["cells"]
    fig = merge_three_panel(occ, free, cells)
    assert isinstance(fig, Figure)
    plt.close(fig)
    del bin_grid


def test_merge_side_by_side():
    weighted = [[0, 1, 0], [1, 1, 0], [0, 0, 1]]
    uniform = [[1, 1, 1], [1, 0, 1], [1, 1, 1]]
    fig = merge_side_by_side(weighted, uniform)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_rep_smallmultiples():
    traces_by_scenario = {}
    target_peers = {}
    for name in ("scenario_a", "scenario_b"):
        per_viewer = {}
        for viewer in ("v1", "v2"):
            tr = ReputationTrace()
            for i in range(5):
                tr.record("attacker", 1.0, 1.0 + i * 2, i * 1_000_000_000)
                tr.record("honest", 1.0 + i, 1.0, i * 1_000_000_000)
            per_viewer[viewer] = tr
        traces_by_scenario[name] = per_viewer
        target_peers[name] = "attacker"
    fig = rep_smallmultiples(traces_by_scenario, target_peers)
    assert isinstance(fig, Figure)
    plt.close(fig)
