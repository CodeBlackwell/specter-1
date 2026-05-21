"""ADR 0016 Wave 1.3 — Levenberg-Marquardt convergence + correctness."""

import math

from specter.slam.pose_graph import (
    LM_MAX_ITERATIONS,
    LandmarkFactor,
    OdometryFactor,
    Pose2,
    PoseGraph,
    between,
    landmark_information,
    odometry_information,
)


def _close(a: float, b: float, tol: float = 1.0e-6) -> bool:
    return abs(a - b) <= tol


def test_lm_converges_on_chain_with_consistent_odometry():
    """Three poses in a chain with consistent odometry — optimizer should
    settle at the exact solution since the initial guess equals truth."""
    pg = PoseGraph()
    truth = [Pose2(0.0, 0.0, 0.0), Pose2(1.0, 0.0, 0.0), Pose2(2.0, 0.0, 0.0)]
    for i, t in enumerate(truth):
        pg.add_pose(f"p{i}", t)
    info = odometry_information(0.5)
    for i in range(len(truth) - 1):
        pg.add_odometry_factor(
            OdometryFactor(
                from_id=f"p{i}",
                to_id=f"p{i+1}",
                measurement=between(truth[i], truth[i + 1]),
                info=info,
                source_id="alpha",
            )
        )
    pg.optimize()
    # At truth, cost is already zero; LM should converge in 1 iteration.
    assert pg.final_cost < 1.0e-12, f"expected zero cost, got {pg.final_cost}"
    for i, t in enumerate(truth):
        recovered = dict(pg.trajectory())[f"p{i}"]
        assert _close(recovered.x, t.x) and _close(recovered.y, t.y) and _close(recovered.theta, t.theta)


def test_lm_corrects_initial_misalignment_from_consistent_measurements():
    """Initialize poses with drift; consistent odometry should pull them back."""
    pg = PoseGraph()
    truth = [Pose2(0.0, 0.0, 0.0), Pose2(1.0, 0.0, 0.0), Pose2(2.0, 0.0, 0.0)]
    # Perturb the non-anchor poses.
    pg.add_pose("p0", truth[0])  # gauge-fixed
    pg.add_pose("p1", Pose2(1.1, 0.05, 0.02))
    pg.add_pose("p2", Pose2(2.15, 0.1, 0.04))
    info = odometry_information(0.5)
    for i in range(len(truth) - 1):
        pg.add_odometry_factor(
            OdometryFactor(
                from_id=f"p{i}",
                to_id=f"p{i+1}",
                measurement=between(truth[i], truth[i + 1]),
                info=info,
                source_id="alpha",
            )
        )
    pre_cost = pg.total_cost()
    pg.optimize()
    assert pg.final_cost < pre_cost / 100.0, (
        f"LM failed to substantially reduce cost: {pre_cost} → {pg.final_cost}"
    )
    # p0 stays at truth (gauge-fixed); p1, p2 should converge near truth.
    traj = dict(pg.trajectory())
    for i in range(1, 3):
        recovered = traj[f"p{i}"]
        assert _close(recovered.x, truth[i].x, tol=1.0e-3), f"p{i}.x drift: {recovered.x}"
        assert _close(recovered.y, truth[i].y, tol=1.0e-3), f"p{i}.y drift: {recovered.y}"
        assert _close(recovered.theta, truth[i].theta, tol=1.0e-3)


def test_lm_localizes_landmark_from_two_pose_observations():
    """Two poses observe a landmark; LM should recover the landmark position
    even from a wrong initial landmark estimate. Pose-1 is also free here so
    the landmark recovery shares precision with the small pose-1 adjustment;
    5mm tolerance reflects this coupling at MVP numeric-Jacobian fidelity."""
    pg = PoseGraph()
    p0 = Pose2(0.0, 0.0, 0.0)
    p1 = Pose2(2.0, 0.0, 0.0)
    lm_truth = (1.0, 1.0)
    pg.add_pose("p0", p0)
    pg.add_pose("p1", p1)
    # Bad initial landmark guess:
    pg.add_landmark("lm0", (0.0, 0.0))

    # Compute truthful observations.
    for pose_id, t in [("p0", p0), ("p1", p1)]:
        dx, dy = lm_truth[0] - t.x, lm_truth[1] - t.y
        r = math.hypot(dx, dy)
        b = math.atan2(dy, dx) - t.theta
        pg.add_landmark_factor(
            LandmarkFactor(
                pose_id=pose_id,
                landmark_id="lm0",
                range_m=r,
                bearing_rad=b,
                info=landmark_information(r),
                source_id="alpha",
            )
        )
    pg.optimize()
    recovered_lm = pg.landmarks()["lm0"]
    assert _close(recovered_lm[0], lm_truth[0], tol=5.0e-3)
    assert _close(recovered_lm[1], lm_truth[1], tol=5.0e-3)


def test_lm_iterations_bounded_by_max():
    """Iteration count never exceeds the ADR 0016 §9 cap."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("p1", Pose2(0.5, 0.0, 0.0))  # 0.5m off truth
    info = odometry_information(0.5)
    pg.add_odometry_factor(
        OdometryFactor(
            from_id="p0",
            to_id="p1",
            measurement=Pose2(1.0, 0.0, 0.0),  # truth says 1.0m
            info=info,
            source_id="alpha",
        )
    )
    pg.optimize()
    assert pg.iterations_last_run <= LM_MAX_ITERATIONS


def test_pose_graph_first_pose_is_gauge_anchor():
    """Per ADR 0016 §12: pose-0 is fixed by direct elimination, not optimized."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("p1", Pose2(5.0, 0.0, 0.0))  # wildly off
    pg.add_odometry_factor(
        OdometryFactor(
            from_id="p0",
            to_id="p1",
            measurement=Pose2(1.0, 0.0, 0.0),
            info=odometry_information(0.5),
            source_id="alpha",
        )
    )
    pg.optimize()
    # p0 must stay at identity (gauge-fixed).
    traj = dict(pg.trajectory())
    p0_final = traj["p0"]
    assert p0_final.x == 0.0 and p0_final.y == 0.0 and p0_final.theta == 0.0
    # p1 should move to satisfy the odometry constraint.
    p1_final = traj["p1"]
    assert _close(p1_final.x, 1.0, tol=1.0e-3)


def test_lm_returns_final_cost_after_optimize():
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_odometry_factor(
        OdometryFactor(
            from_id="p0",
            to_id="p1",
            measurement=Pose2(1.0, 0.0, 0.0),
            info=odometry_information(0.5),
            source_id="alpha",
        )
    )
    pg.optimize()
    assert pg.final_cost >= 0.0
    assert pg.final_cost < 1.0e-12
