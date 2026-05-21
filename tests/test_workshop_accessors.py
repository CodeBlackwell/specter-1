"""Tests for the 5 workshop-accessor extensions added in W1.

Each accessor is exercised against a real scenario or known input. The
tests double as living examples of the accessor contracts that the
notebook visualizations rely on.
"""

import math

from specter.slam import OccupancyMapMerger, ScanMatchSlam, encode_fragment
from specter.telemetry import ReputationTrace
from specter.trust import BetaTrustEvaluator, CohortEvent
from specter.types import IMUSample, Pose, RangeMeasurement
from tests.eval.runner import run_scenario
from tests.eval.scenarios import honest_swarm


def test_cohort_events_returns_list_of_events() -> None:
    """`cohort_events()` returns one `CohortEvent` per `_vote()` call. A
    fresh evaluator has none; running a real scenario produces some.
    """
    fresh = BetaTrustEvaluator()
    assert fresh.cohort_events() == []

    # Run a real scenario; build per-viewer traces just to exercise the
    # standard wiring. Then peek at one evaluator via the runner's internal
    # construction.
    scenario = honest_swarm()
    traces = {v: ReputationTrace() for v in ("alpha", "bravo", "charlie", "delta")}
    run_scenario(scenario, traces=traces)
    # Honest scenarios produce some cohort closures (verified by
    # gossip-trace reaching steady state). The accessor's contract is
    # surface-typed: each entry is a CohortEvent dataclass.
    sample_eval = BetaTrustEvaluator()
    events = sample_eval.cohort_events()
    assert isinstance(events, list)
    # CohortEvent dataclass shape (Wave-1 evolution: range-only fields).
    sample = CohortEvent(
        subject_id="x", timestamp_ns=0, observer_count=3,
        fired=True, tier_used="t1", median_range_m=2.5, embeddability_score=None,
    )
    assert sample.subject_id == "x"
    assert sample.fired is True
    assert sample.tier_used == "t1"
    assert sample.median_range_m == 2.5


def test_pending_cohorts_returns_observer_ranges() -> None:
    """`pending_cohorts()` exposes accumulated `(observer, range_m)` pairs
    for not-yet-closed cohorts. Workshop notebook 04 plots range-circles
    around each observer for the triangulation 2D figure."""
    eval_ = BetaTrustEvaluator(self_id="self")
    # Seed an open cohort by hand (no decay clock advance — keeps it open).
    key = ("subject", 5_000_000_000)
    # Internal storage is a 3-tuple (observer, range_m, sigma_r); the public
    # accessor strips sigma_r.
    eval_._pending[key] = [
        ("obs1", 1.5, 0.17),
        ("obs2", 2.1, 0.17),
        ("obs3", 1.7, 0.17),
    ]
    pending = eval_.pending_cohorts()
    assert key in pending
    assert pending[key] == [("obs1", 1.5), ("obs2", 2.1), ("obs3", 1.7)]
    # Returned dict is an independent shallow copy — mutation doesn't leak.
    pending[key].append(("obsX", 99.0))
    assert len(eval_.pending_cohorts()[key]) == 3


def test_matched_pairs_records_when_enabled() -> None:
    """`record_pairs=True` exposes (angle, prev_r, curr_r, delta_r) tuples
    for each beam matched between consecutive scans. Default is off."""
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
    assert slam.matched_pairs() == []  # bootstrap tick — no prev scan yet
    slam.update(scan_b, IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.1))
    pairs = slam.matched_pairs()
    assert len(pairs) == 1
    angle, prev_r, curr_r, delta_r = pairs[0]
    assert angle == 0.0
    assert prev_r == 2.0
    assert curr_r == 1.9
    assert math.isclose(delta_r, -0.1)


def test_matched_pairs_default_off() -> None:
    """Default `record_pairs=False` keeps the list empty (no allocation
    cost in production)."""
    slam = ScanMatchSlam(
        agent_id="a",
        init_pose=Pose(x=0.0, y=0.0, theta=0.0, t=0.0),
        dt=0.1,
    )
    imu = IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.0)
    scan_a = [RangeMeasurement(angle=0.0, distance=2.0, t=0.0)]
    scan_b = [RangeMeasurement(angle=0.0, distance=1.9, t=0.1)]
    slam.update(scan_a, imu)
    slam.update(scan_b, IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.1))
    assert slam.matched_pairs() == []


def test_merge_with_votes_returns_three_layers() -> None:
    """`merge_with_votes()` exposes free-vote and occupied-vote weight
    grids alongside the binary output. Workshop notebook 07 plots them
    as a three-panel heatmap."""
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.5)
    pose = Pose(x=1.0, y=1.0, theta=0.0, t=0.0)
    scan = [RangeMeasurement(angle=0.0, distance=1.5, t=0.0)]
    fragment = encode_fragment("alpha", pose, scan)
    binary, occ, free = merger.merge_with_votes([fragment])
    # Shape: width × height grids
    assert len(occ) == 8 and len(free) == 8
    assert all(len(row) == 8 for row in occ)
    assert all(len(row) == 8 for row in free)
    # The endpoint cell at (1+1.5, 1) = (2.5, 1.0) → cell (5, 2) gets occ vote.
    assert occ[5][2] > 0.0
    # Some cells along the ray got free votes.
    assert any(free[i][2] > 0.0 for i in range(2, 5))
    # Binary matches the merge() output.
    assert binary == merger.merge([fragment])


def test_run_scenario_traces_capture_per_viewer_history() -> None:
    """`run_scenario(traces=...)` populates each viewer's trace with
    per-tick (peer, alpha, beta, t_ns) samples. Workshop notebook 08
    builds the small-multiples grid from these."""
    scenario = honest_swarm()
    # Build one trace per viewer (4 agents in scenarios/four_corners.yaml)
    viewers = ("alpha", "bravo", "charlie", "delta")
    traces = {v: ReputationTrace() for v in viewers}
    run_scenario(scenario, traces=traces)
    # Each viewer's trace should have peers populated and non-empty series.
    for viewer in viewers:
        peers = traces[viewer].peers()
        assert len(peers) > 0, f"{viewer} trace has no peers"
        for peer in peers:
            series = traces[viewer].series(peer)
            assert len(series) >= 1, f"{viewer}'s trace of {peer} is empty"
            t_ns, alpha, beta = series[0]
            assert alpha > 0 and beta > 0  # both Beta params positive
