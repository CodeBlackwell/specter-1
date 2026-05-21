"""ADR 0016 Wave 1.4 — GNC (Geman-McClure) outlier suppression."""

import math

from specter.slam.pose_graph import (
    GNC_MAX_OUTER_ITER,
    LandmarkFactor,
    OdometryFactor,
    Pose2,
    PoseGraph,
    between,
    landmark_information,
    odometry_information,
)


def _make_landmark_chain(n_inliers: int, outlier_bias: float = 0.0) -> PoseGraph:
    """One pose at origin, n_inliers landmark observations of a landmark at (5, 0).
    If outlier_bias != 0, the LAST observation is biased by that range (a lying
    measurement that GNC should suppress)."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))  # initial guess wrong
    truth = (5.0, 0.0)
    measured_range = math.hypot(truth[0], truth[1])
    measured_bearing = math.atan2(truth[1], truth[0])
    for i in range(n_inliers):
        pg.add_landmark_factor(
            LandmarkFactor(
                pose_id="p0",
                landmark_id="lm0",
                range_m=measured_range,
                bearing_rad=measured_bearing,
                info=landmark_information(measured_range),
                source_id=f"obs_{i}",
            )
        )
    if outlier_bias != 0.0:
        pg.add_landmark_factor(
            LandmarkFactor(
                pose_id="p0",
                landmark_id="lm0",
                range_m=measured_range + outlier_bias,
                bearing_rad=measured_bearing,
                info=landmark_information(measured_range),
                source_id="outlier",
            )
        )
    return pg


def test_gnc_with_no_outliers_matches_lm_solution():
    """Without outliers, GNC should converge to the same solution as LM."""
    pg_lm = _make_landmark_chain(3)
    pg_lm.optimize()
    pg_gnc = _make_landmark_chain(3)
    pg_gnc.optimize_gnc()
    lm_pos = pg_lm.landmarks()["lm0"]
    gnc_pos = pg_gnc.landmarks()["lm0"]
    assert abs(lm_pos[0] - gnc_pos[0]) < 1.0e-3
    assert abs(lm_pos[1] - gnc_pos[1]) < 1.0e-3


def test_gnc_suppresses_large_outlier():
    """One large outlier among 3 inliers — GNC should drive its weight near
    zero, landmark recovered close to truth (5, 0). Naive LM gets dragged."""
    pg_lm = _make_landmark_chain(3, outlier_bias=5.0)  # outlier says range=10, truth=5
    pg_lm.optimize()
    lm_naive = pg_lm.landmarks()["lm0"]

    pg_gnc = _make_landmark_chain(3, outlier_bias=5.0)
    pg_gnc.optimize_gnc()
    lm_robust = pg_gnc.landmarks()["lm0"]

    # GNC should be measurably closer to truth (5, 0) than naive LM.
    naive_err = math.hypot(lm_naive[0] - 5.0, lm_naive[1] - 0.0)
    robust_err = math.hypot(lm_robust[0] - 5.0, lm_robust[1] - 0.0)
    assert robust_err < naive_err, (
        f"GNC failed to reduce error: naive={naive_err:.4f} m, robust={robust_err:.4f} m"
    )
    # Outlier weight should be much smaller than inlier weights.
    weights = pg_gnc.gnc_weights()
    outlier_w = weights[next(k for k in weights if "outlier" in k)]
    inlier_ws = [w for k, w in weights.items() if "outlier" not in k]
    assert outlier_w < min(inlier_ws), f"outlier weight {outlier_w} ≥ min inlier {min(inlier_ws)}"


def test_gnc_outer_iterations_bounded():
    pg = _make_landmark_chain(3, outlier_bias=5.0)
    pg.optimize_gnc()
    assert pg.gnc_outer_iters_last_run <= GNC_MAX_OUTER_ITER


def test_gnc_geman_mcclure_weight_in_unit_interval():
    """Per Yang 2020 §IV.A, Geman-McClure weights w_i = (μ/(μ+χ²))² ∈ [0, 1]."""
    pg = _make_landmark_chain(3, outlier_bias=5.0)
    pg.optimize_gnc()
    for k, w in pg.gnc_weights().items():
        assert 0.0 <= w <= 1.0, f"weight {k}={w} out of [0,1]"


def test_gnc_factor_weights_set_for_all_factors():
    """Every odometry + landmark factor in the graph should have a weight after GNC."""
    pg = PoseGraph()
    truth = [Pose2(0.0, 0.0, 0.0), Pose2(1.0, 0.0, 0.0), Pose2(2.0, 0.0, 0.0)]
    for i, t in enumerate(truth):
        pg.add_pose(f"p{i}", t)
    for i in range(len(truth) - 1):
        pg.add_odometry_factor(
            OdometryFactor(
                from_id=f"p{i}",
                to_id=f"p{i+1}",
                measurement=between(truth[i], truth[i + 1]),
                info=odometry_information(0.5),
                source_id="alpha",
            )
        )
    pg.optimize_gnc()
    assert len(pg.gnc_weights()) == 2  # two odometry factors
