"""Analytic Jacobian validation — compares the closed-form Jacobians swapped
into the LM optimizer against the central-difference numeric Jacobians on a
sweep of representative configurations. Tolerance is 1.0e-6 absolute element
(numeric central-diff truncation floor is O(ε²)≈1e-12 but cancellation +
1/r² terms push the realized tolerance higher)."""

import math

import numpy as np
import pytest

from specter.slam.pose_graph import (
    JAC_EPS,
    LandmarkFactor,
    OdometryFactor,
    Pose2,
    _analytic_jac_inter_robot,
    _analytic_jac_landmark,
    _analytic_jac_relative_pose,
    _jacobian_landmark,
    _jacobian_pose,
    compose,
    exp_se2,
    landmark_information,
    odometry_information,
)


def _numeric_pose_jac(residual_fn, t: Pose2, m: int) -> np.ndarray:
    return _jacobian_pose(residual_fn, t)[:m, :]


def _numeric_lm_jac(residual_fn, lm: tuple[float, float], m: int) -> np.ndarray:
    return _jacobian_landmark(residual_fn, lm)[:m, :]


LANDMARK_CASES = [
    (Pose2(0.0, 0.0, 0.0), (3.0, 2.0)),
    (Pose2(1.5, -0.5, 0.7), (4.0, 1.0)),
    (Pose2(-2.0, 3.0, -1.2), (1.0, 5.0)),
    (Pose2(0.5, 0.5, 2.5), (2.0, 2.0)),
    (Pose2(0.0, 0.0, math.pi / 4), (0.0, 3.0)),
]


@pytest.mark.parametrize("t, lm", LANDMARK_CASES)
def test_landmark_jacobian_matches_numeric(t: Pose2, lm: tuple[float, float]):
    factor = LandmarkFactor(
        pose_id="p",
        landmark_id="l",
        range_m=math.hypot(lm[0] - t.x, lm[1] - t.y),
        bearing_rad=0.0,
        info=landmark_information(2.0),
        source_id="alpha",
    )

    def res_at_pose(ti: Pose2) -> tuple[float, ...]:
        return factor.residual({"p": ti}, {"l": lm})

    def res_at_lm(lmk: tuple[float, float]) -> tuple[float, ...]:
        return factor.residual({"p": t}, {"l": lmk})

    j_p, j_l = _analytic_jac_landmark(t, lm)
    j_p_num = _numeric_pose_jac(res_at_pose, t, 2)
    j_l_num = _numeric_lm_jac(res_at_lm, lm, 2)
    assert np.allclose(j_p, j_p_num, atol=1.0e-6), f"pose jac\nA={j_p}\nN={j_p_num}"
    assert np.allclose(j_l, j_l_num, atol=1.0e-6), f"lm jac\nA={j_l}\nN={j_l_num}"


INTER_ROBOT_CASES = [
    (Pose2(0.0, 0.0, 0.0),     Pose2(3.0, 1.0, 0.5)),
    (Pose2(1.0, 1.0, 0.3),     Pose2(-2.0, 2.0, -0.8)),
    (Pose2(0.5, -1.5, -0.9),   Pose2(2.0, 0.5, 1.2)),
    (Pose2(0.0, 0.0, math.pi), Pose2(1.0, 0.0, 0.0)),
]


@pytest.mark.parametrize("t_obs, t_target", INTER_ROBOT_CASES)
def test_inter_robot_jacobian_matches_numeric(t_obs: Pose2, t_target: Pose2):
    # Inter-robot factor is normalized to a LandmarkFactor at insertion;
    # exercise the same residual shape with the analytic helper.
    dx = t_target.x - t_obs.x
    dy = t_target.y - t_obs.y
    cos_o = math.cos(t_obs.theta)
    sin_o = math.sin(t_obs.theta)
    bx = cos_o * dx + sin_o * dy
    by = -sin_o * dx + cos_o * dy
    r = math.hypot(bx, by)
    factor = LandmarkFactor(
        pose_id="p_obs",
        landmark_id="p_target",
        range_m=r,
        bearing_rad=math.atan2(by, bx),
        info=landmark_information(r),
        source_id="alpha",
    )

    def res_at_obs(ti: Pose2) -> tuple[float, ...]:
        return factor.residual({"p_obs": ti}, {"p_target": (t_target.x, t_target.y)})

    j_obs_analytic, _ = _analytic_jac_inter_robot(t_obs, t_target)
    j_obs_num_3 = _jacobian_pose(res_at_obs, t_obs)  # 2x3
    assert np.allclose(j_obs_analytic, j_obs_num_3, atol=1.0e-6), (
        f"observer jac\nA={j_obs_analytic}\nN={j_obs_num_3}"
    )

    # Observed-side Jacobian: under right-perturbation T_target ← T_target·exp(δ)
    # via the (x, y, θ) variable parameterization.
    eps = JAC_EPS
    j_target_num = np.zeros((2, 3))
    for k in range(3):
        dp = [0.0, 0.0, 0.0]
        dm = [0.0, 0.0, 0.0]
        dp[k] = eps
        dm[k] = -eps
        t_plus = compose(t_target, exp_se2((dp[0], dp[1], dp[2])))
        t_minus = compose(t_target, exp_se2((dm[0], dm[1], dm[2])))
        r_plus = factor.residual({"p_obs": t_obs}, {"p_target": (t_plus.x, t_plus.y)})
        r_minus = factor.residual({"p_obs": t_obs}, {"p_target": (t_minus.x, t_minus.y)})
        for i in range(2):
            j_target_num[i, k] = (r_plus[i] - r_minus[i]) / (2.0 * eps)
    _, j_target_analytic = _analytic_jac_inter_robot(t_obs, t_target)
    assert np.allclose(j_target_analytic, j_target_num, atol=1.0e-6), (
        f"observed jac\nA={j_target_analytic}\nN={j_target_num}"
    )


ODOMETRY_CASES = [
    (Pose2(0.0, 0.0, 0.0),    Pose2(1.0, 0.0, 0.1),  Pose2(1.0, 0.0, 0.1)),
    (Pose2(0.5, 0.5, 0.3),    Pose2(1.5, 1.0, 0.6),  Pose2(0.9, 0.5, 0.3)),
    (Pose2(-1.0, 2.0, -0.4),  Pose2(0.0, 1.0, 0.2),  Pose2(1.0, -1.2, 0.5)),
    (Pose2(0.0, 0.0, 1.5),    Pose2(2.0, -1.0, -0.7), Pose2(1.8, -0.9, -2.1)),
]


@pytest.mark.parametrize("t_i, t_j, z", ODOMETRY_CASES)
def test_odometry_jacobian_matches_numeric(t_i: Pose2, t_j: Pose2, z: Pose2):
    factor = OdometryFactor(
        from_id="i",
        to_id="j",
        measurement=z,
        info=odometry_information(0.1),
        source_id="alpha",
    )

    def res_at_i(ti: Pose2) -> tuple[float, ...]:
        return factor.residual({"i": ti, "j": t_j})

    def res_at_j(tj: Pose2) -> tuple[float, ...]:
        return factor.residual({"i": t_i, "j": tj})

    r = factor.residual({"i": t_i, "j": t_j})
    j_i, j_j = _analytic_jac_relative_pose(t_i, t_j, r)
    j_i_num = _jacobian_pose(res_at_i, t_i)
    j_j_num = _jacobian_pose(res_at_j, t_j)
    # Wider tolerance for relative-pose Jacobians (involves matrix inverse of
    # J_r and SE(2) adjoint — composed numeric error floor is higher).
    assert np.allclose(j_i, j_i_num, atol=1.0e-5), f"i jac\nA={j_i}\nN={j_i_num}"
    assert np.allclose(j_j, j_j_num, atol=1.0e-5), f"j jac\nA={j_j}\nN={j_j_num}"
