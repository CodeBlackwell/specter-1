"""ADR 0016 Wave 1.2 — odometry + landmark factors with correct IMU compounding."""

import math

import pytest

from specter.slam.pose_graph import (
    DEFAULT_IMU_ACCEL_BIAS_SIGMA,
    DEFAULT_IMU_GYRO_BIAS_SIGMA,
    LandmarkFactor,
    OdometryFactor,
    Pose2,
    between,
    landmark_information,
    odometry_information,
)


def _close(a: float, b: float, tol: float = 1.0e-10) -> bool:
    return abs(a - b) <= tol


# ---- IMU compounding correctness (ADR 0016 §5) ------------------------------


def test_odometry_information_uses_t_1_5_compounding_for_position():
    """σ_xy = σ_a · Δt^1.5 / √3 — Forster 2015 §4. Verify against the
    closed-form value at a representative Δt."""
    dt = 0.5  # 10 ticks at dt=0.05s
    omega = odometry_information(dt)
    expected_sigma_xy = DEFAULT_IMU_ACCEL_BIAS_SIGMA * dt**1.5 / math.sqrt(3.0)
    expected_inv_var_xy = 1.0 / (expected_sigma_xy * expected_sigma_xy)
    assert _close(omega[0][0], expected_inv_var_xy)
    assert _close(omega[1][1], expected_inv_var_xy)
    assert omega[0][1] == 0.0 and omega[1][0] == 0.0


def test_odometry_information_uses_t_0_5_compounding_for_heading():
    """σ_θ = σ_g · √Δt — single-integrated gyro bias random walk."""
    dt = 0.5
    omega = odometry_information(dt)
    expected_sigma_th = DEFAULT_IMU_GYRO_BIAS_SIGMA * math.sqrt(dt)
    expected_inv_var_th = 1.0 / (expected_sigma_th * expected_sigma_th)
    assert _close(omega[2][2], expected_inv_var_th)


def test_odometry_information_position_uncertainty_grows_faster_than_linear():
    """Empirical test of the t^1.5 vs t^1 distinction — the entire reason v1
    of ADR 0016 was wrong. Doubling Δt should *more than* halve the inv-variance."""
    omega_1 = odometry_information(1.0)
    omega_2 = odometry_information(2.0)
    # σ_xy doubles → σ²_xy quadruples → inv_var quarters at t=2 vs t=1 if linear.
    # Actually t^1.5: σ_xy at t=2 is 2^1.5 = 2.83×; σ²_xy is 8×; inv_var is 1/8th.
    ratio = omega_2[0][0] / omega_1[0][0]
    assert _close(ratio, 1.0 / 8.0, tol=1.0e-12)


def test_odometry_information_rejects_nonpositive_dt():
    with pytest.raises(ValueError):
        odometry_information(0.0)
    with pytest.raises(ValueError):
        odometry_information(-0.1)


# ---- Landmark information --------------------------------------------------


def test_landmark_information_range_dependent_sigma():
    """σ_r = σ_beacon · (1 + d/10) per ADR 0005."""
    omega_near = landmark_information(0.0)
    omega_far = landmark_information(10.0)
    # At range 10m, σ_r doubles, so inv_var_r quarters.
    assert _close(omega_far[0][0] / omega_near[0][0], 0.25)


def test_landmark_information_nlos_inflates_range_sigma_by_3x():
    """NLOS-tagged observations inflate σ_r by NLOS_INFLATE=3 per ADR 0016 §5."""
    omega_los = landmark_information(5.0, nlos=False)
    omega_nlos = landmark_information(5.0, nlos=True)
    # σ_r triples → σ²_r 9× → inv_var 1/9th.
    assert _close(omega_nlos[0][0] / omega_los[0][0], 1.0 / 9.0)
    # Bearing σ is independent of NLOS.
    assert _close(omega_nlos[1][1], omega_los[1][1])


def test_landmark_information_bearing_independent_of_range():
    """Bearing σ does not scale with range — only PDOA depends on signal geometry."""
    omega_a = landmark_information(1.0)
    omega_b = landmark_information(20.0)
    assert _close(omega_a[1][1], omega_b[1][1])


# ---- OdometryFactor residual -----------------------------------------------


def test_odometry_residual_zero_at_exact_solution():
    """When (T_i, T_j) match the measured Δ exactly, residual = 0."""
    t_i = Pose2(1.0, 2.0, 0.5)
    delta = Pose2(0.5, -0.2, 0.3)
    t_j = Pose2(
        t_i.x + math.cos(t_i.theta) * delta.x - math.sin(t_i.theta) * delta.y,
        t_i.y + math.sin(t_i.theta) * delta.x + math.cos(t_i.theta) * delta.y,
        t_i.theta + delta.theta,
    )
    info = odometry_information(0.5)
    f = OdometryFactor(from_id="p0", to_id="p1", measurement=delta, info=info, source_id="alpha")
    r = f.residual({"p0": t_i, "p1": t_j})
    assert all(_close(x, 0.0, tol=1.0e-10) for x in r)


def test_odometry_residual_nonzero_under_perturbation():
    """Perturbing one pose by an SE(2) tangent vector produces a residual."""
    t_i = Pose2(0.0, 0.0, 0.0)
    t_j = Pose2(1.0, 0.0, 0.0)
    delta = between(t_i, t_j)  # exact measurement
    info = odometry_information(0.5)
    f = OdometryFactor(from_id="p0", to_id="p1", measurement=delta, info=info, source_id="alpha")
    # Perturb t_j by (0.1, 0, 0) in body frame.
    t_j_perturbed = Pose2(1.1, 0.0, 0.0)
    r = f.residual({"p0": t_i, "p1": t_j_perturbed})
    # Residual ρ_x should reflect the 0.1m shift.
    assert _close(r[0], 0.1, tol=1.0e-10)
    assert _close(r[1], 0.0, tol=1.0e-10)
    assert _close(r[2], 0.0, tol=1.0e-10)


# ---- LandmarkFactor residual -----------------------------------------------


def test_landmark_residual_zero_at_exact_solution():
    """Measurement matches the predicted (range, bearing) from pose → landmark."""
    t = Pose2(0.0, 0.0, 0.0)
    landmark = (3.0, 4.0)  # 5m away, bearing atan2(4,3) ≈ 0.9273 rad
    measured_range = 5.0
    measured_bearing = math.atan2(4.0, 3.0)
    info = landmark_information(measured_range)
    f = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=measured_range,
        bearing_rad=measured_bearing,
        info=info,
        source_id="alpha",
    )
    r = f.residual({"p0": t}, {"lm0": landmark})
    assert _close(r[0], 0.0, tol=1.0e-12)
    assert _close(r[1], 0.0, tol=1.0e-12)


def test_landmark_residual_under_pose_rotation():
    """Rotating the pose 90° CCW about origin moves the landmark from
    'straight ahead' to 'straight to my right' in body frame — bearing
    component should change accordingly."""
    t = Pose2(0.0, 0.0, math.pi / 2)  # facing +y
    landmark = (1.0, 0.0)  # ahead of original pose, now to the right of rotated pose
    measured_range = 1.0
    measured_bearing = -math.pi / 2  # body-frame: to the right
    info = landmark_information(1.0)
    f = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=measured_range,
        bearing_rad=measured_bearing,
        info=info,
        source_id="alpha",
    )
    r = f.residual({"p0": t}, {"lm0": landmark})
    assert _close(r[0], 0.0, tol=1.0e-12)
    assert _close(r[1], 0.0, tol=1.0e-12)


def test_landmark_residual_bearing_wraps_canonically():
    """Bearing residual lands in (-π, π] even when raw difference crosses ±π."""
    t = Pose2(0.0, 0.0, 0.0)
    landmark = (-1.0, 0.0)  # behind, predicted bearing = ±π
    # Measure as +π but prediction = -π (or vice versa); residual should be tiny.
    info = landmark_information(1.0)
    f = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=1.0,
        bearing_rad=math.pi,
        info=info,
        source_id="alpha",
    )
    r = f.residual({"p0": t}, {"lm0": landmark})
    assert _close(r[0], 0.0, tol=1.0e-12)
    # Either prediction is +π or -π; wrapped difference must be small (≤1e-10).
    assert abs(r[1]) <= 1.0e-10 or abs(abs(r[1]) - 0.0) <= 1.0e-10
