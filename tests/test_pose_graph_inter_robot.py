"""ADR 0016 Wave 3 — inter-robot factors + Umeyama Sim(2) alignment."""

import math

from specter.slam.pose_graph import (
    InterRobotFactor,
    Pose2,
    PoseGraph,
    Sim2,
    landmark_information,
    umeyama_sim2,
)


def _close(a: float, b: float, tol: float = 1.0e-6) -> bool:
    return abs(a - b) <= tol


# ---- Umeyama Sim(2) alignment ---------------------------------------------


def test_umeyama_recovers_identity_from_identical_points():
    """Same source and destination → identity rotation + translation, scale = 1."""
    points = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)]
    s = umeyama_sim2(points, points)
    assert s is not None
    assert _close(s.x, 0.0) and _close(s.y, 0.0)
    assert _close(s.theta, 0.0)
    assert _close(s.scale, 1.0)


def test_umeyama_recovers_pure_translation():
    """Destination shifted by (3, 5) → translation (3, 5), no rotation/scale change."""
    src = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)]
    dst = [(3.0, 5.0), (4.0, 5.0), (3.0, 6.0)]
    s = umeyama_sim2(src, dst)
    assert s is not None
    assert _close(s.x, 3.0, tol=1.0e-10)
    assert _close(s.y, 5.0, tol=1.0e-10)
    assert _close(s.theta, 0.0)
    assert _close(s.scale, 1.0, tol=1.0e-10)


def test_umeyama_recovers_pure_rotation_90deg():
    """Destination rotated 90° CCW about origin → recover θ = π/2."""
    src = [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
    # R(π/2): (1, 0) → (0, 1); (0, 1) → (-1, 0); (-1, 0) → (0, -1).
    dst = [(0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)]
    s = umeyama_sim2(src, dst)
    assert s is not None
    assert _close(s.theta, math.pi / 2, tol=1.0e-10)
    assert _close(s.scale, 1.0, tol=1.0e-10)


def test_umeyama_recovers_scale_factor():
    """Source scaled 2x → scale = 2.0."""
    src = [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
    dst = [(2.0, 0.0), (0.0, 2.0), (-2.0, 0.0)]
    s = umeyama_sim2(src, dst)
    assert s is not None
    assert _close(s.scale, 2.0, tol=1.0e-10)
    assert _close(s.theta, 0.0)


def test_umeyama_returns_none_below_two_points():
    assert umeyama_sim2([(0.0, 0.0)], [(1.0, 1.0)]) is None


def test_umeyama_returns_none_for_coincident_source():
    assert umeyama_sim2([(1.0, 1.0), (1.0, 1.0)], [(0.0, 0.0), (2.0, 2.0)]) is None


def test_umeyama_returns_sim2_dataclass_with_named_fields():
    """API contract: Sim2 has (x, y, theta, scale) fields for callers."""
    s = umeyama_sim2([(0.0, 0.0), (1.0, 0.0)], [(0.0, 0.0), (1.0, 0.0)])
    assert isinstance(s, Sim2)
    assert hasattr(s, "x") and hasattr(s, "y") and hasattr(s, "theta") and hasattr(s, "scale")


# ---- InterRobotFactor -----------------------------------------------------


def test_inter_robot_factor_residual_zero_at_exact_solution():
    """Two agents with known (range, bearing) between them — zero residual at truth."""
    poses = {"a": Pose2(0.0, 0.0, 0.0), "b": Pose2(3.0, 4.0, 0.5)}
    range_m = 5.0  # |b - a| from a's body frame
    bearing_rad = math.atan2(4.0, 3.0)
    f = InterRobotFactor(
        observer_pose_id="a",
        observed_pose_id="b",
        range_m=range_m,
        bearing_rad=bearing_rad,
        info=landmark_information(range_m),
        source_id="a",
    )
    r = f.residual(poses)
    assert _close(r[0], 0.0, tol=1.0e-12)
    assert _close(r[1], 0.0, tol=1.0e-12)


def test_inter_robot_factor_integrates_into_pose_graph():
    """Add inter-robot factor to PoseGraph; it should be ingested via the
    landmark-factor pipeline (the observed pose's (x,y) gets a virtual
    landmark variable mirrored)."""
    pg = PoseGraph()
    pg.add_pose("a", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("b", Pose2(3.0, 4.0, 0.0))  # initial estimate at truth
    f = InterRobotFactor(
        observer_pose_id="a",
        observed_pose_id="b",
        range_m=5.0,
        bearing_rad=math.atan2(4.0, 3.0),
        info=landmark_information(5.0),
        source_id="a",
    )
    pg.add_inter_robot_factor(f)
    # The observed pose's (x, y) was mirrored as a landmark variable.
    assert "b" in pg.landmarks()
    # Cost should be near zero at the truth initialization.
    assert pg.total_cost() < 1.0e-12
