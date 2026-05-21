"""ADR 0017 Wave 2 — loop closure detection via landmark co-visibility."""

import math

from specter.slam.pose_graph import (
    LOOP_MIN_KEYFRAME_GAP,
    LandmarkFactor,
    LoopClosureFactor,
    OdometryFactor,
    Pose2,
    PoseGraph,
    between,
    landmark_information,
    odometry_information,
)


def _close(a: float, b: float, tol: float = 1.0e-6) -> bool:
    return abs(a - b) <= tol


def _add_landmark_obs(pg: PoseGraph, pose_id: str, pose: Pose2, lm_id: str, lm_pos: tuple[float, float]):
    dx, dy = lm_pos[0] - pose.x, lm_pos[1] - pose.y
    r = math.hypot(dx, dy)
    b = math.atan2(dy, dx) - pose.theta
    pg.add_landmark_factor(
        LandmarkFactor(
            pose_id=pose_id,
            landmark_id=lm_id,
            range_m=r,
            bearing_rad=b,
            info=landmark_information(r),
            source_id="alpha",
        )
    )


def test_loop_closure_detected_when_landmarks_overlap():
    """Build a 12-pose loop: agent returns to near-start at pose 11. Shared
    landmarks with pose 0 trigger a closure detection."""
    pg = PoseGraph()
    # 12 poses around a small loop returning to origin.
    truth = [Pose2(float(i % 6), float(i // 6), 0.0) for i in range(12)]
    for i, t in enumerate(truth):
        pg.add_pose(f"p{i}", t)
    # Landmarks at (0, 0) and (1, 0) seen by p0 and p10 (returns near start).
    for pid in ["p0", "p10"]:
        idx = int(pid[1:])
        _add_landmark_obs(pg, pid, truth[idx], "lm_a", (0.0, 0.5))
        _add_landmark_obs(pg, pid, truth[idx], "lm_b", (1.0, 0.5))
    closures = pg.detect_loop_closures()
    assert len(closures) >= 1
    c = closures[0]
    assert c.from_id == "p0" and c.to_id == "p10"


def test_no_loop_closure_for_adjacent_poses():
    """Within MIN_KEYFRAME_GAP, no closure even if landmarks overlap (those
    poses are already constrained by sequential odometry)."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("p1", Pose2(0.1, 0.0, 0.0))  # too close to be a loop
    _add_landmark_obs(pg, "p0", Pose2(0.0, 0.0, 0.0), "lm_a", (1.0, 0.0))
    _add_landmark_obs(pg, "p1", Pose2(0.1, 0.0, 0.0), "lm_a", (1.0, 0.0))
    assert pg.detect_loop_closures() == []


def test_no_closure_below_min_shared_landmarks():
    pg = PoseGraph()
    for i in range(12):
        pg.add_pose(f"p{i}", Pose2(0.0, 0.0, 0.0))
    # Only 1 shared landmark — below threshold of 2.
    _add_landmark_obs(pg, "p0", Pose2(0.0, 0.0, 0.0), "lm_a", (1.0, 0.0))
    _add_landmark_obs(pg, "p11", Pose2(0.0, 0.0, 0.0), "lm_a", (1.0, 0.0))
    assert pg.detect_loop_closures() == []


def test_loop_closure_factor_residual_matches_odometry_factor_form():
    """LoopClosureFactor residual is the same algebra as OdometryFactor."""
    p0 = Pose2(0.0, 0.0, 0.0)
    p10 = Pose2(0.1, 0.05, 0.0)  # slightly off — closure has small residual
    measurement = Pose2(0.0, 0.0, 0.0)  # measured Δ is identity
    info = odometry_information(1.0)
    f = LoopClosureFactor(from_id="p0", to_id="p10", measurement=measurement, info=info)
    r = f.residual({"p0": p0, "p10": p10})
    # Predicted Δ = between(p0, p10) = (0.1, 0.05, 0). Measured = identity.
    # Residual = log(measurement^-1 · predicted) = log((0.1, 0.05, 0)) ≈ (0.1, 0.05, 0).
    assert _close(r[0], 0.1, tol=1.0e-12)
    assert _close(r[1], 0.05, tol=1.0e-12)
    assert _close(r[2], 0.0, tol=1.0e-12)


def test_loop_closure_integrates_into_pose_graph_optimizer():
    """Add closure → optimize → drift snap. Closure factor must reduce cost."""
    pg = PoseGraph()
    truth = [Pose2(float(i), 0.0, 0.0) for i in range(12)]
    for i, t in enumerate(truth):
        # Inject drift on intermediate poses; p0 and p11 at truth.
        if i in (0, 11):
            pg.add_pose(f"p{i}", t)
        else:
            pg.add_pose(f"p{i}", Pose2(t.x + 0.05 * i, 0.01 * i, 0.005 * i))
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
    # Add a closure: p0 and p11 directly constrained.
    pg.add_loop_closure_factor(
        LoopClosureFactor(
            from_id="p0", to_id="p11", measurement=between(truth[0], truth[11]), info=info
        )
    )
    pre_cost = pg.total_cost()
    pg.optimize()
    assert pg.final_cost < pre_cost / 10.0


def test_loop_closure_constants_from_adr():
    assert LOOP_MIN_KEYFRAME_GAP == 10
