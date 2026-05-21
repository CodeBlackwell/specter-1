"""Pose-graph SLAM per ADR 0016. SE(2) primitives land in Wave 1.1; factors,
LM, GNC, and sparse Cholesky follow in Waves 1.2 → 1.5.

SE(2) conventions (locked by ADR 0016 §6):
- Pose `T ∈ SE(2)` represented as the tuple (x, y, θ); θ in radians, no
  wrap normalization (callers do it where needed — keeps math closed-form).
- Group operation `T1 ⊕ T2`: 2D rigid-body composition. `compose(T1, T2)`
  places T2's body frame into T1's world frame.
- Right perturbation: update step is `T ← T ⊕ exp(δ̂)` where `δ ∈ se(2)`
  is the *body-frame* tangent increment. This is the convention used by the
  optimizer's normal-equations Jacobian assembly in Wave 1.3+.
- exp / log / right-Jacobian: per Barfoot §7.3 + Solà arXiv:1812.01537 §4.

Determinism contract (ADR 0016 §12): pure functional, no RNG, no globals.

Parity contract (ADR 0016 §14): every SE(2) primitive here matches its TS
counterpart in `ui/packages/sim-core/src/poseGraph.ts` to 10 decimals on
the parity fixture. SE(2) is the foundation — if it diverges, every
downstream piece diverges.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as _np  # used only for the linear solve (Wave 1.3+)

# Below this |θ|, use the Taylor expansion of V(θ) and V⁻¹(θ) to avoid
# division by zero / numerical noise. Threshold chosen so the truncation
# error is ≤ 1e-14 (well below the parity tolerance), driven by the next
# Taylor term magnitude θ³/24 ≈ 1.6e-14 at θ=1e-5.
SE2_SMALL_ANGLE_TAU = 1.0e-5


@dataclass(frozen=True)
class Pose2:
    """SE(2) element (x, y, θ). θ in radians; no automatic wrapping —
    composition wraps lazily, log() returns θ ∈ (-π, π]."""

    x: float
    y: float
    theta: float


# Identity element of SE(2).
IDENTITY = Pose2(0.0, 0.0, 0.0)


def wrap_angle(theta: float) -> float:
    """Wrap θ to (-π, π]. Used by log() so the returned tangent vector is
    canonical; compose() does not wrap because the algebra is closed regardless.

    Numerical detail: atan2(sin θ, cos θ) returns values in [-π, π]. Inputs at
    or near multiples of π can drift to either +π or -π depending on
    floating-point roundoff. We snap anything within 1e-12 of -π up to +π so
    the canonical (-π, π] convention holds robustly across both branches."""
    wrapped = math.atan2(math.sin(theta), math.cos(theta))
    if wrapped <= -math.pi + 1.0e-12:
        return math.pi
    return wrapped


def compose(a: Pose2, b: Pose2) -> Pose2:
    """T_a ⊕ T_b: place T_b's body frame in T_a's world frame.

    (R_a, t_a) · (R_b, t_b) = (R_a R_b, R_a t_b + t_a)
    """
    cos_a = math.cos(a.theta)
    sin_a = math.sin(a.theta)
    return Pose2(
        x=a.x + cos_a * b.x - sin_a * b.y,
        y=a.y + sin_a * b.x + cos_a * b.y,
        theta=a.theta + b.theta,
    )


def inverse(a: Pose2) -> Pose2:
    """T⁻¹: (R, t)⁻¹ = (R^T, -R^T t)."""
    cos_a = math.cos(a.theta)
    sin_a = math.sin(a.theta)
    return Pose2(
        x=-cos_a * a.x - sin_a * a.y,
        y=sin_a * a.x - cos_a * a.y,
        theta=-a.theta,
    )


def between(a: Pose2, b: Pose2) -> Pose2:
    """Relative pose of b in a's frame: T_ab = T_a⁻¹ ⊕ T_b. This is the
    natural form for the odometry-factor residual: measured Δ vs predicted
    `between(T_i, T_{i+1})`."""
    return compose(inverse(a), b)


def exp_se2(xi: tuple[float, float, float]) -> Pose2:
    """Exponential map se(2) → SE(2). ξ = (ρ_x, ρ_y, θ).

    For θ ≠ 0:
        V(θ) = (1/θ) [[sin θ, -(1 - cos θ)], [1 - cos θ, sin θ]]
        exp(ξ) = (V(θ) ρ, θ)

    For |θ| < SE2_SMALL_ANGLE_TAU, use the Taylor expansion of V(θ):
        V(θ) ≈ I + (θ/2) J   where J = skew(1) = [[0, -1], [1, 0]]
        higher-order terms negligible at the chosen threshold.
    """
    rho_x, rho_y, theta = xi
    if abs(theta) < SE2_SMALL_ANGLE_TAU:
        # First-order Taylor: V ≈ I + (θ/2) J. Drop O(θ²) — it's < 1e-14 at the threshold.
        half_theta = 0.5 * theta
        t_x = rho_x - half_theta * rho_y
        t_y = half_theta * rho_x + rho_y
        return Pose2(x=t_x, y=t_y, theta=theta)
    sin_t = math.sin(theta)
    cos_t = math.cos(theta)
    a = sin_t / theta
    b = (1.0 - cos_t) / theta
    t_x = a * rho_x - b * rho_y
    t_y = b * rho_x + a * rho_y
    return Pose2(x=t_x, y=t_y, theta=theta)


def log_se2(t: Pose2) -> tuple[float, float, float]:
    """Logarithm map SE(2) → se(2). Returns ξ = (ρ_x, ρ_y, θ) such that
    `exp_se2(log_se2(T)) == T` to machine precision.

    For θ ≠ 0:
        V⁻¹(θ) = (θ / (2(1 - cos θ))) [[sin θ, 1 - cos θ], [-(1 - cos θ), sin θ]]
        (equivalent to (θ/2) [[sin θ/(1-cos θ), 1], [-1, sin θ/(1-cos θ)]])
        ρ = V⁻¹(θ) · t

    For |θ| < SE2_SMALL_ANGLE_TAU, use the Taylor expansion:
        V⁻¹(θ) ≈ I - (θ/2) J   where J = skew(1)
    """
    theta = wrap_angle(t.theta)
    if abs(theta) < SE2_SMALL_ANGLE_TAU:
        half_theta = 0.5 * theta
        rho_x = t.x + half_theta * t.y
        rho_y = -half_theta * t.x + t.y
        return (rho_x, rho_y, theta)
    half_theta = 0.5 * theta
    # cot(θ/2) = cos(θ/2) / sin(θ/2). Numerically stable form: (θ/2) / tan(θ/2).
    # V⁻¹ entries: top-left = (θ/2) cot(θ/2); off-diagonal magnitude = θ/2.
    half_cot = half_theta / math.tan(half_theta)
    rho_x = half_cot * t.x + half_theta * t.y
    rho_y = -half_theta * t.x + half_cot * t.y
    return (rho_x, rho_y, theta)


# Polish A — SE(2) Right Jacobian per Solà arXiv:1812.01537 §6 / Barfoot §7.6.2.
# Validated against numeric central-difference of log(exp(ξ) ⊕ exp(δ)) w.r.t. δ
# (see tests/test_pose_graph_se2.py::test_right_jacobian_*). Used by the LM
# optimizer via `_analytic_jac_relative_pose` for odometry / loop closure /
# inter-robot Jacobians. Landmark factor Jacobians are derived directly inline
# (see _analytic_jac_landmark). Numeric Jacobians remain available as the
# reference path for the validation tests (test_pose_graph_analytic_jacobians).


def right_jacobian_se2(xi: tuple[float, float, float]) -> tuple[
    tuple[float, float, float],
    tuple[float, float, float],
    tuple[float, float, float],
]:
    """Right Jacobian J_r(ξ) ∈ R^{3×3} of the SE(2) exponential map.

    Satisfies log(exp(ξ) ⊕ exp(δ)) ≈ ξ + J_r(ξ)^{-1} · δ for small δ, i.e.,
    J_r(ξ)^{-1} relates a body-frame perturbation δ at exp(ξ) back to the
    equivalent perturbation in ξ-tangent.

    For SE(2) with ξ = (ρ_x, ρ_y, θ):
        J_r(ξ) = [[V(-θ),  Q(ρ, θ)],
                   [0,      1      ]]
    where V is the SE(2) Jacobian (also appearing in exp), and the Q column
    captures translation-rotation coupling. Bottom row is (0, 0, 1) because
    SO(2) is 1-D and its right Jacobian on θ is identically 1.

    Small-angle branch (|θ| < SE2_SMALL_ANGLE_TAU) uses the first-order
    Taylor: J_r(ξ) ≈ I - (1/2) ad(ξ), where ad(ξ) for SE(2) is the matrix
    that captures the Lie bracket structure (derived in tests).

    Validation: tests/test_pose_graph_se2.py verifies this formula against
    numeric central-difference of log(exp(ξ) ⊕ exp(δ)) at 7 representative
    ξ values to 10 decimals.
    """
    rho_x, rho_y, theta = xi
    # Closed form derived from the SE(2) group action:
    #   exp(ξ) ⊕ exp(δ) = exp((ξ + J_r^{-1} δ)̂) for small δ
    # gives J_r = [[V(-θ),  R(-θ) · (dV(θ)/dθ) · ρ],
    #              [0_{1×2}, 1                       ]]
    # since R(-θ) · V(θ) = V(-θ) (verified algebraically). The Q column captures
    # translation-rotation coupling; the small-angle limit recovers the
    # I - (1/2) · ad(ξ) Taylor form with the correct signs.
    if abs(theta) < SE2_SMALL_ANGLE_TAU:
        # Small-angle limit derived directly from the general formula's Taylor
        # expansion: q_x → -ρ_y/2, q_y → ρ_x/2 (verified against numeric
        # central-difference of log(exp(ξ) ⊕ exp(δ)) at ξ → 0). Upper-left
        # 2×2 is V(-θ) ≈ I - (θ/2) skew(1) = [[1, θ/2], [-θ/2, 1]].
        return (
            (1.0, 0.5 * theta, -0.5 * rho_y),
            (-0.5 * theta, 1.0, 0.5 * rho_x),
            (0.0, 0.0, 1.0),
        )
    sin_t = math.sin(theta)
    cos_t = math.cos(theta)
    # V(-θ) = (1/θ) [[sin θ, 1-cos θ], [-(1-cos θ), sin θ]].
    v_neg_00 = sin_t / theta
    v_neg_01 = (1.0 - cos_t) / theta
    v_neg_10 = -v_neg_01
    v_neg_11 = v_neg_00
    # dV/dθ · ρ where V(θ) = (1/θ) [[sin θ, -(1-cos θ)], [1-cos θ, sin θ]]:
    #   dV/dθ = (1/θ²) [[θ cos θ - sin θ,        -(θ sin θ - (1 - cos θ))],
    #                    [θ sin θ - (1 - cos θ),  θ cos θ - sin θ          ]]
    inv_theta_sq = 1.0 / (theta * theta)
    dvr_x = inv_theta_sq * (
        (theta * cos_t - sin_t) * rho_x
        + (-(theta * sin_t - (1.0 - cos_t))) * rho_y
    )
    dvr_y = inv_theta_sq * (
        (theta * sin_t - (1.0 - cos_t)) * rho_x
        + (theta * cos_t - sin_t) * rho_y
    )
    # Q = R(-θ) · (dV/dθ · ρ).  R(-θ) = [[cos θ, sin θ], [-sin θ, cos θ]].
    q_x = cos_t * dvr_x + sin_t * dvr_y
    q_y = -sin_t * dvr_x + cos_t * dvr_y
    return (
        (v_neg_00, v_neg_01, q_x),
        (v_neg_10, v_neg_11, q_y),
        (0.0, 0.0, 1.0),
    )


# ---------------------------------------------------------------------------
# Wave 1.2 — Factors + sensor noise → information matrix per ADR 0016 §5.
# ---------------------------------------------------------------------------

# Sensor noise defaults from ADR 0005 (UWB beacon model).
DEFAULT_BEACON_RANGE_SIGMA_M = 0.10
DEFAULT_BEACON_RANGE_SCALE_M = 10.0  # σ_r = σ_beacon · (1 + d / range_scale)
DEFAULT_BEACON_BEARING_SIGMA_RAD = math.radians(5.0)
NLOS_INFLATE = 3.0  # ADR 0016 §5: inflate σ_r when bus tags observation NLOS

# IMU bias drift defaults (per ADR 0005 / 0007). σ_a in m/s²/√s (accelerometer
# bias random walk), σ_g in rad/s/√s (gyro bias random walk).
DEFAULT_IMU_ACCEL_BIAS_SIGMA = 0.005
DEFAULT_IMU_GYRO_BIAS_SIGMA = 0.0005


def odometry_information(
    dt_seconds: float,
    sigma_a_bias: float = DEFAULT_IMU_ACCEL_BIAS_SIGMA,
    sigma_g_bias: float = DEFAULT_IMU_GYRO_BIAS_SIGMA,
) -> tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]:
    """Information matrix Ω = diag(1/σ_x², 1/σ_y², 1/σ_θ²) for an odometry
    factor spanning Δt seconds, with the **correct compounding laws** per
    ADR 0016 §5 + Forster et al. RSS 2015 §4:

    - Position σ from accelerometer bias drift: `σ_xy = σ_a · Δt^1.5 / √3`
      (double-integrated random walk).
    - Heading σ from gyro bias drift: `σ_θ = σ_g · √Δt` (single-integrated).

    The simple `σ × Δt` model used in v1 of ADR 0016 was wrong; the t^1.5/t^0.5
    compounding is the load-bearing correctness step that distinguishes
    production-grade IMU error propagation from naive approximations.
    """
    if dt_seconds <= 0.0:
        raise ValueError(f"dt_seconds must be positive, got {dt_seconds}")
    sigma_xy = sigma_a_bias * dt_seconds**1.5 / math.sqrt(3.0)
    sigma_th = sigma_g_bias * math.sqrt(dt_seconds)
    inv_var_xy = 1.0 / (sigma_xy * sigma_xy)
    inv_var_th = 1.0 / (sigma_th * sigma_th)
    return (
        (inv_var_xy, 0.0, 0.0),
        (0.0, inv_var_xy, 0.0),
        (0.0, 0.0, inv_var_th),
    )


def landmark_information(
    range_m: float,
    nlos: bool = False,
    sigma_beacon_range: float = DEFAULT_BEACON_RANGE_SIGMA_M,
    range_scale: float = DEFAULT_BEACON_RANGE_SCALE_M,
    sigma_bearing_rad: float = DEFAULT_BEACON_BEARING_SIGMA_RAD,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Information matrix Ω = diag(1/σ_r², 1/σ_b²) for a landmark factor with
    range-dependent σ_r per ADR 0005 and the NLOS inflation per ADR 0016 §5."""
    sigma_r = sigma_beacon_range * (1.0 + range_m / range_scale)
    if nlos:
        sigma_r *= NLOS_INFLATE
    inv_var_r = 1.0 / (sigma_r * sigma_r)
    inv_var_b = 1.0 / (sigma_bearing_rad * sigma_bearing_rad)
    return ((inv_var_r, 0.0), (0.0, inv_var_b))


@dataclass(frozen=True)
class OdometryFactor:
    """Binary factor between two pose variables, encoding a measured relative
    pose `T_ij` in the from-frame. Residual is `log(T_ij^-1 ⊕ between(T_i, T_j))`
    — the SE(2) tangent of the mismatch between predicted and measured Δ."""

    from_id: str
    to_id: str
    measurement: Pose2
    info: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
    source_id: str

    def variable_ids(self) -> tuple[str, str]:
        return (self.from_id, self.to_id)

    def residual(self, poses: dict[str, Pose2]) -> tuple[float, float, float]:
        predicted = between(poses[self.from_id], poses[self.to_id])
        delta = compose(inverse(self.measurement), predicted)
        return log_se2(delta)


@dataclass(frozen=True)
class InterRobotFactor:
    """Range + bearing observation between two agents' poses. Algebraically
    identical to LandmarkFactor (relative-pose-via-(range, bearing) constraint),
    but the "observed" variable is another agent's pose rather than a static
    landmark — supports Wave 3 multi-agent cooperative SLAM per ADR 0016 §12
    + ADR 0019 (forthcoming) frame alignment.

    The observer is `observer_pose_id` and emits the measurement in its body
    frame. `observed_pose_id` is the target agent's pose at the corresponding
    timestamp. Reputation gating uses `source_id` (the observing agent), so
    a lying observer's factor information is downweighted exactly like a
    lying landmark observer (ADR 0018 Wave 4 reputation prior)."""

    observer_pose_id: str
    observed_pose_id: str
    range_m: float
    bearing_rad: float
    info: tuple[tuple[float, float], tuple[float, float]]
    source_id: str
    nlos: bool = False

    def variable_ids(self) -> tuple[str, str]:
        return (self.observer_pose_id, self.observed_pose_id)

    def residual(self, poses: dict[str, Pose2]) -> tuple[float, float]:
        # Treat the observed pose's (x, y) as if it were a landmark in the
        # observer's body frame; identical algebra to LandmarkFactor.
        t = poses[self.observer_pose_id]
        target = poses[self.observed_pose_id]
        dx = target.x - t.x
        dy = target.y - t.y
        cos_t = math.cos(t.theta)
        sin_t = math.sin(t.theta)
        body_x = cos_t * dx + sin_t * dy
        body_y = -sin_t * dx + cos_t * dy
        predicted_range = math.hypot(body_x, body_y)
        predicted_bearing = math.atan2(body_y, body_x)
        return (
            self.range_m - predicted_range,
            wrap_angle(self.bearing_rad - predicted_bearing),
        )


@dataclass(frozen=True)
class LoopClosureFactor:
    """Loop closure between two non-adjacent poses, encoding a measured
    relative SE(2) pose derived from shared-landmark geometry per ADR 0017.
    Algebraically identical to `OdometryFactor` — only differs in how it's
    discovered (landmark co-visibility) and the source-id ('loop_closure')."""

    from_id: str
    to_id: str
    measurement: Pose2
    info: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
    source_id: str = "loop_closure"

    def variable_ids(self) -> tuple[str, str]:
        return (self.from_id, self.to_id)

    def residual(self, poses: dict[str, Pose2]) -> tuple[float, float, float]:
        predicted = between(poses[self.from_id], poses[self.to_id])
        delta = compose(inverse(self.measurement), predicted)
        return log_se2(delta)


@dataclass(frozen=True)
class LandmarkFactor:
    """Binary factor between a pose and a landmark, encoding a (range, bearing)
    observation in the pose's body frame. Residual is `(measured - predicted)`
    with the bearing component wrapped to (-π, π]."""

    pose_id: str
    landmark_id: str
    range_m: float
    bearing_rad: float
    info: tuple[tuple[float, float], tuple[float, float]]
    source_id: str
    nlos: bool = False

    def variable_ids(self) -> tuple[str, str]:
        return (self.pose_id, self.landmark_id)

    def residual(self, poses: dict[str, Pose2], landmarks: dict[str, tuple[float, float]]) -> tuple[float, float]:
        t = poses[self.pose_id]
        lx, ly = landmarks[self.landmark_id]
        dx = lx - t.x
        dy = ly - t.y
        cos_t = math.cos(t.theta)
        sin_t = math.sin(t.theta)
        body_x = cos_t * dx + sin_t * dy
        body_y = -sin_t * dx + cos_t * dy
        predicted_range = math.hypot(body_x, body_y)
        predicted_bearing = math.atan2(body_y, body_x)
        return (
            self.range_m - predicted_range,
            wrap_angle(self.bearing_rad - predicted_bearing),
        )


# ---------------------------------------------------------------------------
# Wave 1.3 — Levenberg-Marquardt with adaptive damping per ADR 0016 §7.
# Inner linear solve: dense Cholesky (sparse + AMD lands in Wave 1.5; the
# outer LM loop is identical, only the solve_step abstraction changes).
# Jacobians: central-difference numeric (ε = 1e-6) — avoids the Right
# Jacobian sign-discovery hazard that drove its Wave 1.1 deferral.
# ---------------------------------------------------------------------------

# Central-difference step for numeric Jacobians. ε = 1e-6 gives O(ε²) ≈ 1e-12
# truncation error (well below parity tolerance) while keeping O(ε⁻¹·u) ≈
# 1e-10 floating-point rounding error within the 10-decimal contract.
JAC_EPS = 1.0e-6

LM_INITIAL_LAMBDA_SCALE = 1.0e-4  # ADR 0016 §7: λ₀ = 1e-4 · max(diag(H))
LM_MAX_ITERATIONS = 10  # ADR 0016 §9: hard cap (per μ-level under GNC)
LM_CONVERGE_DELTA = 1.0e-6  # ‖δ‖_∞ tolerance
LM_CONVERGE_COST_RATIO = 1.0e-4  # relative cost reduction tolerance
LM_LAMBDA_UP = 10.0
LM_LAMBDA_DOWN = 10.0
LM_LAMBDA_MAX = 1.0e8

# Wave 1.4 — GNC (Graduated Non-Convexity) per Yang/Antonante/Tzoumas/
# Carlone RA-L 2020 §IV.A. Geman-McClure family chosen for continuous
# differentiability (clean LM Jacobians) at comparable robustness to
# truncated-LS. The μ-schedule decays from μ₀ until no factor changes
# inlier↔outlier class, OR μ falls below GNC_MU_FLOOR.
GNC_C_BAR = 1.0  # inlier residual threshold (||r||_Ω scale)
GNC_MU_DECAY = 1.4  # μ_{k+1} = μ_k / GNC_MU_DECAY
GNC_MU_FLOOR = 1.0e-6  # outer-loop termination on μ
GNC_MAX_OUTER_ITER = 32  # safety cap; typical convergence in 8-15 outer iters
GNC_WEIGHT_CHANGE_TAU = 1.0e-4  # weight-class change threshold for outer-loop stop

# Wave 2 — Loop closure detection per ADR 0017 (landmark co-visibility).
LOOP_MIN_KEYFRAME_GAP = 10  # adjacent keyframes aren't loop candidates
LOOP_MIN_SHARED_LANDMARKS = 2  # SE(2) minimum to determine relative pose
LOOP_RESIDUAL_TAU_M = 0.5  # closure rejected if geometric residual > τ

# Wave 4 — exogenous-prior DCS reputation weighting per ADR 0018.
# Identity mapping `r := reputation` with a floor that prevents complete
# factor exclusion (keeps Hessian sparsity pattern stable across LM iters).
REPUTATION_FLOOR = 0.01

# Dynamic Covariance Scaling (Agarwal et al. ICRA 2013) — `s(χ²) = (2Φ/(Φ+χ²))²`.
# Φ is the inlier scale: at χ² = Φ, `s = 1`; at large χ², `s → 0`. Used by the
# `"dcs"` baseline mode in `PoseGraph.set_weight_mode("dcs")`. Default Φ = 1.0
# matches Agarwal's reference choice for unit-variance residuals.
DCS_PHI_DEFAULT = 1.0


def dcs_scaling(chi2: float, phi: float = DCS_PHI_DEFAULT) -> float:
    """Agarwal 2013 dynamic-covariance-scaling factor.

    Returns `1.0` if `χ² ≤ Φ` (inlier), else `(2Φ/(Φ+χ²))²` (outlier
    downweight). Bounded in [0, 1]. Used as the standalone baseline weight
    when `weight_mode == "dcs"`.
    """
    if chi2 <= phi:
        return 1.0
    ratio = 2.0 * phi / (phi + chi2)
    return ratio * ratio

# ADR 0019 — chi-square thresholds for 2-DOF range/bearing residuals.
# F(1.386, 2) = 0.50 (honest-median); F(5.991, 2) = 0.95 (95% inlier bound).
SLAM_CHISQ_INLIER = 1.386
SLAM_CHISQ_OUTLIER = 5.991

# ADR 0022 — singleton-uniqueness penalty and stale-singleton fade.
# SINGLETON_INFO_SCALE: information scaling for landmarks observed by exactly
# one distinct reporter. 0.3 → 1σ inflation of 1/√0.3 ≈ 1.83×, roughly
# equivalent to a 5°→9° bearing-noise hit on an unverified measurement.
# T_CORROBORATE: ticks of grace before fade starts. T_FADE: ticks over which
# fade ramps to zero after the grace window. See ADR 0022 §§2-3 for the
# calibration justification (50 m perimeter, 0.5 m/s, ~200 ticks/circuit).
SINGLETON_INFO_SCALE = 0.3
T_CORROBORATE = 200
T_FADE = 200

# ADR 0022 §4 — reputation-tracking switch prior for `weight_mode="switchable"`.
# γ_i(t) = γ_base · r_now · GAMMA_REP_SCALE + GAMMA_FLOOR.
# Sünderhauf's SC prior `√γ·(1-s)` pulls s → 1 (the inlier hypothesis); closed-
# form optimum is s* = γ / (‖r‖² + γ). Mapping reputation onto γ in this
# direction means a high-rep peer keeps the strong anchor (system trusts the
# report against modest residuals) while a low-rep peer's prior releases
# (γ → floor), letting any residual evidence drive s_i → 0.
# GAMMA_FLOOR ≠ 0 keeps the SC Hessian's switch diagonal numerically stable
# when rep collapses (otherwise the diagonal becomes pure ‖r‖² — fine but
# parity-sensitive to exact-zero ordering of floating-point additions).
GAMMA_REP_SCALE = 10.0
GAMMA_FLOOR = 0.01


@dataclass(frozen=True)
class Provenance:
    """Per-factor insertion record (ADR 0022 §1). Stamped on every
    LandmarkFactor / InterRobotFactor / LoopClosureFactor when added so
    the singleton-cap and stale-singleton-fade mechanisms have a
    deterministic input. Inert when those mechanisms are disabled.
    """

    reporter_id: str
    insertion_tick: int
    reputation_at_insertion: float


def _accumulate_evidence(
    out: dict[str, dict[str, float]], source_id: str, alpha: float, beta: float
) -> None:
    bucket = out.setdefault(source_id, {"alpha": 0.0, "beta": 0.0})
    bucket["alpha"] += alpha
    bucket["beta"] += beta


def _solve_relative_pose_from_shared_landmarks(
    body_i: list[tuple[float, float]],
    body_j: list[tuple[float, float]],
) -> Pose2 | None:
    """Closed-form SE(2) transform `T_ij` mapping j-body-frame landmark
    positions onto i-body-frame. Per Umeyama 1991 (ADR 0017 closure
    geometry, ADR 0019 inter-agent alignment): given correspondences
    {(p_i, p_j)} sharing the same physical landmarks, the relative pose
    is determined by aligning the centroid + rotation between them.

    For SE(2) with ≥ 2 correspondences: rotation from the angle between
    the two centroid-relative vectors; translation closes the loop.
    Returns None if the configurations are degenerate (both landmarks
    coincident).
    """
    n = len(body_i)
    if n != len(body_j) or n < 2:
        return None
    cx_i = sum(p[0] for p in body_i) / n
    cy_i = sum(p[1] for p in body_i) / n
    cx_j = sum(p[0] for p in body_j) / n
    cy_j = sum(p[1] for p in body_j) / n
    # SVD-style rotation estimate per Umeyama §3 (2D special case):
    #   compute H = Σ (p_j - c_j) (p_i - c_i)ᵀ, then R via atan2.
    sxx = sum((body_j[k][0] - cx_j) * (body_i[k][0] - cx_i) for k in range(n))
    sxy = sum((body_j[k][0] - cx_j) * (body_i[k][1] - cy_i) for k in range(n))
    syx = sum((body_j[k][1] - cy_j) * (body_i[k][0] - cx_i) for k in range(n))
    syy = sum((body_j[k][1] - cy_j) * (body_i[k][1] - cy_i) for k in range(n))
    theta = math.atan2(sxy - syx, sxx + syy)
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    tx = cx_i - (cos_t * cx_j - sin_t * cy_j)
    ty = cy_i - (sin_t * cx_j + cos_t * cy_j)
    return Pose2(tx, ty, theta)


# Wave 3 — Umeyama Sim(2) alignment per ADR 0019 (forthcoming).
@dataclass(frozen=True)
class Sim2:
    """Sim(2) element: SE(2) + uniform scale `s > 0`. Used by Wave 3 inter-
    agent frame alignment per Umeyama 1991 [R7]. For honest peers, the
    optimal scale ≈ 1; deviation flags miscalibration or adversarial scale
    inflation."""

    x: float
    y: float
    theta: float
    scale: float


def umeyama_sim2(
    src: list[tuple[float, float]],
    dst: list[tuple[float, float]],
) -> Sim2 | None:
    """Closed-form Sim(2) transform mapping `src` points to `dst` points
    per Umeyama 1991 §3 (2D specialization). Given correspondences
    {(p_src, p_dst)} sharing the same physical entities (e.g., shared
    landmarks observed by two agents), recover `(R, t, s)` minimizing
    Σ ‖s · R · p_src + t - p_dst‖². Returns None for fewer than 2
    correspondences or degenerate (collinear coincident) sources.

    This is the inter-agent frame alignment kernel for ADR 0016 §12 +
    ADR 0019 — used in Wave 3 to anchor inter-agent pose-graph frames
    given shared-landmark correspondences. Honest peers yield scale ≈ 1.
    """
    n = len(src)
    if n != len(dst) or n < 2:
        return None
    # Centroids.
    cx_s = sum(p[0] for p in src) / n
    cy_s = sum(p[1] for p in src) / n
    cx_d = sum(p[0] for p in dst) / n
    cy_d = sum(p[1] for p in dst) / n
    # Variance of source (for scale).
    var_s = sum(((p[0] - cx_s) ** 2 + (p[1] - cy_s) ** 2) for p in src) / n
    if var_s == 0.0:
        return None
    # Cross-covariance (2D simplification of Umeyama's SVD).
    sxx = sum((src[k][0] - cx_s) * (dst[k][0] - cx_d) for k in range(n))
    syy = sum((src[k][1] - cy_s) * (dst[k][1] - cy_d) for k in range(n))
    sxy = sum((src[k][0] - cx_s) * (dst[k][1] - cy_d) for k in range(n))
    syx = sum((src[k][1] - cy_s) * (dst[k][0] - cx_d) for k in range(n))
    # Rotation: atan2 of the antisymmetric vs symmetric parts.
    theta = math.atan2(sxy - syx, sxx + syy)
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    # Scale: trace of R · cross-cov / source variance per Umeyama eq. 41.
    scale = ((sxx + syy) * cos_t + (sxy - syx) * sin_t) / (n * var_s)
    if scale <= 0.0:
        # Degenerate (reflection); not a proper similarity.
        return None
    # Translation: aligns centroids after rotation + scaling.
    tx = cx_d - scale * (cos_t * cx_s - sin_t * cy_s)
    ty = cy_d - scale * (sin_t * cx_s + cos_t * cy_s)
    return Sim2(x=tx, y=ty, theta=theta, scale=scale)


def _shared_landmark_alignment_residual(
    body_i: list[tuple[float, float]],
    body_j: list[tuple[float, float]],
    rel: Pose2,
) -> float:
    """Residual norm: max ‖p_i - (R(rel) · p_j + t(rel))‖ over correspondences."""
    cos_t = math.cos(rel.theta)
    sin_t = math.sin(rel.theta)
    max_err = 0.0
    for k in range(len(body_i)):
        px = cos_t * body_j[k][0] - sin_t * body_j[k][1] + rel.x
        py = sin_t * body_j[k][0] + cos_t * body_j[k][1] + rel.y
        e = math.hypot(body_i[k][0] - px, body_i[k][1] - py)
        if e > max_err:
            max_err = e
    return max_err


# ---------------------------------------------------------------------------
# Analytic Jacobians per Solà arXiv:1812.01537 §10.1 (factor linearization).
# Landmark + InterRobot factors: derived inline (range/bearing residual chain).
# Odometry + LoopClosure factors: ∂r/∂δ_j = J_r^{-1}(r); ∂r/∂δ_i = -J_r^{-1}(r) · Ad(E^{-1})
# where E = between(T_i, T_j) and J_r is the SE(2) right Jacobian.
# ---------------------------------------------------------------------------


def _mat3_inverse(m: _np.ndarray) -> _np.ndarray:
    return _np.linalg.inv(m)


def _adjoint_se2(t: Pose2) -> _np.ndarray:
    """Ad(T) ∈ R^{3×3} for T = (x, y, θ) ∈ SE(2). The φ column is (t_y, -t_x, 1)
    — derived from conjugation T · exp(0,0,φ) · T⁻¹ = rotation φ + translation
    (φ·t_y, -φ·t_x) (in 2D, SO(2) commutes so R·R_φ·Rᵀ = R_φ).
    """
    c = math.cos(t.theta)
    s = math.sin(t.theta)
    return _np.array([
        [c, -s,  t.y],
        [s,  c, -t.x],
        [0.0, 0.0, 1.0],
    ])


def _jr_inv_se2(xi: tuple[float, float, float]) -> _np.ndarray:
    return _mat3_inverse(_np.array(right_jacobian_se2(xi)))


def _analytic_jac_landmark(
    t: Pose2, lm: tuple[float, float]
) -> tuple[_np.ndarray, _np.ndarray]:
    """Analytic J_pose (2×3) and J_lm (2×2) for the (range, bearing) residual.

    Residual derivation: r̂ = ‖p_b‖, β̂ = atan2(b_y, b_x), body coords
    p_b = R(-θ) · (lm - t). Under right perturbation T ← T·exp(δ),
    Δp_b = -ρ + φ · (-p_b_y, p_b_x)ᵀ; under lm shift, Δp_b = R(-θ) · δ_lm.
    """
    lx, ly = lm
    dx = lx - t.x
    dy = ly - t.y
    cos_th = math.cos(t.theta)
    sin_th = math.sin(t.theta)
    bx = cos_th * dx + sin_th * dy
    by = -sin_th * dx + cos_th * dy
    r2 = bx * bx + by * by
    # Range/bearing Jacobian is singular at the pose (r → 0); floor to keep the
    # linear system well-posed without affecting the optimum (this only matters
    # when initialization happens to coincide with the landmark).
    if r2 < 1.0e-12:
        r2 = 1.0e-12
    r = math.sqrt(r2)
    j_pose = _np.array([
        [bx / r,    by / r,    0.0],
        [-by / r2,  bx / r2,   1.0],
    ])
    j_lm = _np.array([
        [-bx * cos_th / r + by * sin_th / r,    -bx * sin_th / r - by * cos_th / r],
        [by * cos_th / r2 + bx * sin_th / r2,    by * sin_th / r2 - bx * cos_th / r2],
    ])
    return j_pose, j_lm


def _analytic_jac_inter_robot(
    t_obs: Pose2, t_target: Pose2
) -> tuple[_np.ndarray, _np.ndarray]:
    """Analytic J_observer (2×3) and J_observed (2×3) for the inter-robot
    range+bearing residual. Observer side is identical to LandmarkFactor's J_pose;
    observed side perturbs the target pose under right-perturbation (residual is
    invariant under target θ — third column is 0)."""
    dx = t_target.x - t_obs.x
    dy = t_target.y - t_obs.y
    cos_o = math.cos(t_obs.theta)
    sin_o = math.sin(t_obs.theta)
    bx = cos_o * dx + sin_o * dy
    by = -sin_o * dx + cos_o * dy
    r2 = bx * bx + by * by
    if r2 < 1.0e-12:
        r2 = 1.0e-12
    r = math.sqrt(r2)
    j_observer = _np.array([
        [bx / r,    by / r,    0.0],
        [-by / r2,  bx / r2,   1.0],
    ])
    # Target chain: ∂(bx,by)/∂(ρ_target) = M where φd = θ_obs - θ_target.
    phi_d = t_obs.theta - t_target.theta
    cos_d = math.cos(phi_d)
    sin_d = math.sin(phi_d)
    # left = ∂residual/∂(bx,by) = [[-bx/r, -by/r],[by/r², -bx/r²]]
    # right = [[cos_d, sin_d],[-sin_d, cos_d]]
    j_target = _np.array([
        [-bx * cos_d / r + by * sin_d / r,    -bx * sin_d / r - by * cos_d / r,    0.0],
        [by * cos_d / r2 + bx * sin_d / r2,    by * sin_d / r2 - bx * cos_d / r2,   0.0],
    ])
    return j_observer, j_target


def _analytic_jac_relative_pose(
    t_i: Pose2, t_j: Pose2, residual: tuple[float, float, float]
) -> tuple[_np.ndarray, _np.ndarray]:
    """Analytic J_i (3×3) and J_j (3×3) for the SE(2) relative-pose residual
    r = log(Z⁻¹ · T_i⁻¹ · T_j). Under right perturbations:
       ∂r/∂δ_j = J_r⁻¹(r)
       ∂r/∂δ_i = -J_r⁻¹(r) · Ad(E⁻¹),  E = between(T_i, T_j).
    """
    e = between(t_i, t_j)
    e_inv = inverse(e)
    jr_inv = _jr_inv_se2(residual)
    j_j = jr_inv
    j_i = -jr_inv @ _adjoint_se2(e_inv)
    return j_i, j_j


def _jacobian_pose(residual_fn: object, t: Pose2, eps: float = JAC_EPS) -> _np.ndarray:
    """Central-difference Jacobian ∂r/∂δ ∈ R^{m×3} for residuals depending on
    pose `t` under right perturbation `t ← t ⊕ exp(δ)`."""
    r0 = residual_fn(t)  # type: ignore[operator]
    m = len(r0)
    j = _np.zeros((m, 3))
    for k in range(3):
        dp: list[float] = [0.0, 0.0, 0.0]
        dp[k] = eps
        dm: list[float] = [0.0, 0.0, 0.0]
        dm[k] = -eps
        xi_plus: tuple[float, float, float] = (dp[0], dp[1], dp[2])
        xi_minus: tuple[float, float, float] = (dm[0], dm[1], dm[2])
        r_plus = residual_fn(compose(t, exp_se2(xi_plus)))  # type: ignore[operator]
        r_minus = residual_fn(compose(t, exp_se2(xi_minus)))  # type: ignore[operator]
        for i in range(m):
            j[i, k] = (r_plus[i] - r_minus[i]) / (2.0 * eps)
    return j


def _jacobian_landmark(residual_fn: object, lm: tuple[float, float], eps: float = JAC_EPS) -> _np.ndarray:
    """Central-difference Jacobian ∂r/∂δ ∈ R^{m×2} for residuals depending on
    landmark position `lm` under Euclidean perturbation `lm ← lm + δ`."""
    r0 = residual_fn(lm)  # type: ignore[operator]
    m = len(r0)
    j = _np.zeros((m, 2))
    for k in range(2):
        d_plus: list[float] = [0.0, 0.0]
        d_plus[k] = eps
        d_minus: list[float] = [0.0, 0.0]
        d_minus[k] = -eps
        r_plus = residual_fn((lm[0] + d_plus[0], lm[1] + d_plus[1]))  # type: ignore[operator]
        r_minus = residual_fn((lm[0] + d_minus[0], lm[1] + d_minus[1]))  # type: ignore[operator]
        for i in range(m):
            j[i, k] = (r_plus[i] - r_minus[i]) / (2.0 * eps)
    return j


class PoseGraph:
    """Pose-graph SLAM optimizer per ADR 0016. Single-agent, batch optimization
    with LM + dense Cholesky inner solve (sparse swap in Wave 1.5). Each pose
    is SE(2) (3 DOF), each landmark is R² (2 DOF). pose_0 is gauge-fixed by
    direct elimination from the state vector per ADR 0016 §12.

    Determinism: variable ordering is insertion-order; factor ingestion order
    is insertion-order; numeric Jacobian eps is fixed; LM λ schedule is
    deterministic. No RNG anywhere in the optimizer pipeline.
    """

    def __init__(self) -> None:
        self._pose_ids: list[str] = []
        self._pose_idx: dict[str, int] = {}
        self._landmark_ids: list[str] = []
        self._landmark_idx: dict[str, int] = {}
        self._poses: dict[str, Pose2] = {}
        self._landmarks: dict[str, tuple[float, float]] = {}
        self._odometry_factors: list[OdometryFactor] = []
        self._landmark_factors: list[LandmarkFactor] = []
        self._anchor_pose_id: str | None = None  # gauge-fixed (dropped from state)
        self._iterations_last_run: int = 0
        self._final_cost: float = float("nan")
        # Wave 1.4 GNC + Wave 4 reputation prior. Both are multiplicative
        # weights on the info matrix; composition order is reputation · GNC · Ω
        # per ADR 0018 §2. Reputation is frozen-at-insertion (ADR 0016 §4);
        # GNC updates each μ-level.
        self._factor_weights: dict[str, float] = {}  # GNC's per-iter weights
        self._reputation_weights: dict[str, float] = {}  # frozen-at-insertion fallback
        # Live source: callable source_id → rep ∈ [0,1]; set via
        # set_reputation_source(). Takes precedence over the frozen dict.
        self._reputation_source: Callable[[str], float] | None = None
        self._gnc_outer_iters_last_run: int = 0
        # Baseline-comparison mode (SYSTEM_ASSESSMENT.md §9 rec 1).
        # "exogenous" (default) — `Ω_eff = r · w_gnc · Ω_base` per ADR 0018.
        # "gnc"               — `Ω_eff = w_gnc · Ω_base` (no exogenous prior).
        # "dcs"               — `Ω_eff = s(χ²) · Ω_base` per Agarwal ICRA 2013;
        #                       residual-driven, replaces both reputation and GNC.
        # "switchable"        — Sünderhauf 2012 Switchable Constraints. Per-factor
        #                       switch variable s_i ∈ [0,1] jointly optimized;
        #                       data residual scaled by s, prior `√γ·(1-s)` pulls
        #                       toward inlier. See add_switch + Wave 2 assembly fork.
        self._weight_mode: str = "exogenous"
        self._dcs_phi: float = DCS_PHI_DEFAULT
        # Switchable Constraints state (ADR 0018 Related Work; SC_PLAN Wave 1).
        # `_switches[key] = s ∈ [0,1]` current switch value per registered factor.
        # `_switch_priors[key] = γ > 0` per-factor prior strength.
        # `_switchable_factor_keys` is the deterministic insertion-order list
        # that fixes the switch tail's slot ordering in the state vector.
        # `_switch_idx[key] = position in _switchable_factor_keys` for O(1) slot
        # lookup. `_switch_pre_step` snapshots switches before _apply_step so
        # _revert_step can restore them exactly across [0,1] clamping events
        # (which would otherwise break the -δ round-trip).
        self._switches: dict[str, float] = {}
        self._switch_priors: dict[str, float] = {}
        self._switchable_factor_keys: list[str] = []
        self._switch_idx: dict[str, int] = {}
        self._switch_pre_step: dict[str, float] = {}
        # ADR 0022 — provenance substrate + singleton machinery.
        # `_provenance[factor_key]` records who reported each factor, when,
        # and at what reputation. Populated on add_*_factor when `tick=` is
        # supplied; absent for legacy callers (preserving parity).
        # `_landmark_reporters[landmark_id]` is the deterministic set of
        # distinct reporter_ids for that landmark, used by the singleton cap.
        # `_singleton_cap_enabled` / `_singleton_fade_enabled` are opt-in
        # gates so existing tests (which don't pass ticks) keep their
        # byte-exact behavior until they migrate.
        self._provenance: dict[str, Provenance] = {}
        self._landmark_reporters: dict[str, set[str]] = {}
        self._current_tick: int | None = None
        self._singleton_cap_enabled: bool = False
        self._singleton_fade_enabled: bool = False
        # ADR 0022 §4 — reputation-tracking γ for SC. Off by default so the
        # existing SC math/parity tests are byte-exact unchanged.
        self._rep_tracking_gamma_enabled: bool = False

    # ---- variable + factor ingestion -------------------------------------

    def add_pose(self, pose_id: str, initial: Pose2) -> None:
        if pose_id in self._pose_idx:
            raise ValueError(f"pose {pose_id!r} already added")
        self._pose_idx[pose_id] = len(self._pose_ids)
        self._pose_ids.append(pose_id)
        self._poses[pose_id] = initial
        if self._anchor_pose_id is None:
            self._anchor_pose_id = pose_id  # first pose is the gauge anchor

    def add_landmark(self, landmark_id: str, initial: tuple[float, float]) -> None:
        if landmark_id in self._landmark_idx:
            raise ValueError(f"landmark {landmark_id!r} already added")
        self._landmark_idx[landmark_id] = len(self._landmark_ids)
        self._landmark_ids.append(landmark_id)
        self._landmarks[landmark_id] = initial

    def add_odometry_factor(
        self, factor: OdometryFactor, *, tick: int | None = None
    ) -> None:
        self._odometry_factors.append(factor)
        if tick is not None:
            self._record_provenance(factor, tick)

    def add_landmark_factor(
        self, factor: LandmarkFactor, *, tick: int | None = None
    ) -> None:
        self._landmark_factors.append(factor)
        self._landmark_reporters.setdefault(factor.landmark_id, set()).add(
            factor.source_id
        )
        if tick is not None:
            self._record_provenance(factor, tick)

    def add_inter_robot_factor(
        self, factor: InterRobotFactor, *, tick: int | None = None
    ) -> None:
        """Wave 3 — inter-robot range+bearing factor between two pose variables.
        Algebraically identical to LandmarkFactor; ingested via a `LandmarkFactor`
        wrapper whose `landmark_id` is the observed pose's id."""
        # Reuse the landmark factor pipeline by treating the observed pose's
        # position as a "virtual landmark" tracked by the optimizer. The
        # observed pose remains a SE(2) variable (its θ unconstrained by this
        # factor); only the (x, y) projection is constrained.
        self._landmark_factors.append(
            LandmarkFactor(
                pose_id=factor.observer_pose_id,
                landmark_id=factor.observed_pose_id,
                range_m=factor.range_m,
                bearing_rad=factor.bearing_rad,
                info=factor.info,
                source_id=factor.source_id,
                nlos=factor.nlos,
            )
        )
        # Ensure the observed pose's (x, y) is in the landmark dict (which the
        # LandmarkFactor pipeline reads). We mirror it from the pose dict.
        if factor.observed_pose_id not in self._landmark_idx:
            target = self._poses[factor.observed_pose_id]
            self.add_landmark(factor.observed_pose_id, (target.x, target.y))
        # Mirror the singleton-reporter bookkeeping the LandmarkFactor wrapper
        # would have done if ingested directly through add_landmark_factor.
        self._landmark_reporters.setdefault(factor.observed_pose_id, set()).add(
            factor.source_id
        )
        if tick is not None:
            wrapped = self._landmark_factors[-1]
            self._record_provenance(wrapped, tick)

    def add_loop_closure_factor(
        self, factor: LoopClosureFactor, *, tick: int | None = None
    ) -> None:
        # Loop closure factors slot into the odometry factor list — same
        # algebraic shape, same Jacobian path, same normal-equations assembly.
        wrapped = OdometryFactor(
            from_id=factor.from_id,
            to_id=factor.to_id,
            measurement=factor.measurement,
            info=factor.info,
            source_id=factor.source_id,
        )
        self._odometry_factors.append(wrapped)
        if tick is not None:
            self._record_provenance(wrapped, tick)

    # ---- Wave 2: loop closure detection per ADR 0017 ---------------------

    def detect_loop_closures(
        self,
        min_keyframe_gap: int = LOOP_MIN_KEYFRAME_GAP,
        min_shared_landmarks: int = LOOP_MIN_SHARED_LANDMARKS,
        residual_tau_m: float = LOOP_RESIDUAL_TAU_M,
    ) -> list[LoopClosureFactor]:
        """Find loop closure candidates via landmark co-visibility.

        Returns a list of `LoopClosureFactor` objects, one per (pose_i, pose_j)
        pair whose shared landmark set has ≥ `min_shared_landmarks` entries and
        whose geometric closure residual is ≤ `residual_tau_m`. False-positive
        candidates (residual above τ) are silently dropped per ADR 0017.

        The closure's relative measurement is derived from the shared
        landmarks' body-frame positions (closed-form, deterministic).
        """
        # Build per-pose landmark observation map from landmark factors.
        per_pose_obs: dict[str, dict[str, tuple[float, float]]] = {}
        for f in self._landmark_factors:
            body_x = f.range_m * math.cos(f.bearing_rad)
            body_y = f.range_m * math.sin(f.bearing_rad)
            per_pose_obs.setdefault(f.pose_id, {})[f.landmark_id] = (body_x, body_y)

        closures: list[LoopClosureFactor] = []
        pose_ids = self._pose_ids
        for i, pi in enumerate(pose_ids):
            for j in range(i + min_keyframe_gap, len(pose_ids)):
                pj = pose_ids[j]
                obs_i = per_pose_obs.get(pi, {})
                obs_j = per_pose_obs.get(pj, {})
                shared = sorted(set(obs_i.keys()) & set(obs_j.keys()))
                if len(shared) < min_shared_landmarks:
                    continue
                rel_pose = _solve_relative_pose_from_shared_landmarks(
                    [obs_i[k] for k in shared], [obs_j[k] for k in shared]
                )
                if rel_pose is None:
                    continue
                # Residual check: under truth, applying rel_pose should map
                # j's body-frame points onto i's body-frame points exactly.
                residual_norm = _shared_landmark_alignment_residual(
                    [obs_i[k] for k in shared], [obs_j[k] for k in shared], rel_pose
                )
                if residual_norm > residual_tau_m:
                    continue
                # Information matrix: use odometry info at ~1s (default cadence)
                # as a baseline; closure geometric precision is comparable.
                info = odometry_information(1.0)
                closures.append(
                    LoopClosureFactor(from_id=pi, to_id=pj, measurement=rel_pose, info=info)
                )
        return closures

    # ---- state vector layout --------------------------------------------

    def _free_pose_ids(self) -> list[str]:
        return [pid for pid in self._pose_ids if pid != self._anchor_pose_id]

    def _state_dim(self) -> int:
        # State layout: free-pose deltas (3 DOF each), landmark deltas (2 DOF
        # each), then switch deltas (1 DOF each). The switch tail is empty when
        # no factors have been registered via add_switch.
        return (
            3 * len(self._free_pose_ids())
            + 2 * len(self._landmark_ids)
            + len(self._switchable_factor_keys)
        )

    def _pose_slot(self, pose_id: str) -> int | None:
        """State-vector offset for `pose_id`, or None if gauge-fixed."""
        if pose_id == self._anchor_pose_id:
            return None
        free_ids = self._free_pose_ids()
        return 3 * free_ids.index(pose_id)

    def _landmark_slot(self, landmark_id: str) -> int:
        return 3 * len(self._free_pose_ids()) + 2 * self._landmark_idx[landmark_id]

    def _switch_slot(self, factor_key: str) -> int:
        """State-vector offset for the switch on `factor_key`. Raises if the
        factor is not registered as switchable. O(1) via `_switch_idx`."""
        if factor_key not in self._switch_idx:
            raise KeyError(f"factor {factor_key!r} has no switch (call add_switch first)")
        base = 3 * len(self._free_pose_ids()) + 2 * len(self._landmark_ids)
        return base + self._switch_idx[factor_key]

    def _switch_tail_base(self) -> int:
        """Index of the first switch slot in the state vector."""
        return 3 * len(self._free_pose_ids()) + 2 * len(self._landmark_ids)

    # ---- residual + cost ------------------------------------------------

    @staticmethod
    def _factor_key(factor: object) -> str:
        if isinstance(factor, OdometryFactor):
            return f"odom/{factor.from_id}/{factor.to_id}/{factor.source_id}"
        if isinstance(factor, LandmarkFactor):
            return f"lm/{factor.pose_id}/{factor.landmark_id}/{factor.source_id}"
        raise TypeError(f"unknown factor type: {type(factor)!r}")

    def _weight_of(self, factor: object) -> float:
        """Effective weight = reputation_prior · gnc_weight per ADR 0018 §2.

        Mode dispatch (SYSTEM_ASSESSMENT.md §9 rec 1):
          "exogenous" (default) — `r · w_gnc`, reputation × GNC composition.
          "gnc"                 — `w_gnc` alone, no exogenous prior.
          "dcs"                 — `s(χ²) = (2Φ/(Φ+χ²))²` per Agarwal 2013,
                                  replaces both r and w_gnc with a single
                                  residual-driven scalar.
          "switchable"          — Sünderhauf 2012. `s²` from the per-factor
                                  switch variable (`_switches[key]`); for
                                  non-switchable factors in this mode, weight
                                  is 1.0 (matches `weight_mode = "gnc"` with
                                  GNC disabled — bare LM on that factor). The
                                  switch update + prior residual happen in the
                                  Wave 2 residual + Jacobian assembly fork.

        Reputation source priority for the "exogenous" mode (live → frozen
        → default):
        1. If `_reputation_source` callback is set, query it live by source_id
           — this is the "un-frozen" path used when trust evolves between
           optimize() runs.
        2. Else fall back to `_reputation_weights` set at insertion time
           (the original frozen-at-insertion behavior preserved for callers
           that explicitly opt in via set_reputation_weight).
        3. Else 1.0 (no exogenous prior — pure SLAM).
        """
        key = self._factor_key(factor)
        singleton = self._singleton_scale(factor)
        if self._weight_mode == "dcs":
            chi2 = self._factor_mahalanobis_sq(factor)
            return singleton * dcs_scaling(chi2, self._dcs_phi)
        if self._weight_mode == "switchable":
            # SC effective info scaling is `s²`. Non-switchable factors run
            # weight = 1.0 (bare LM contribution). The switch's joint
            # optimization happens in the Wave 2 assembly fork — _weight_of
            # here only handles the `_factor_mahalanobis_sq` / total_cost
            # consumers that read the effective per-factor weight.
            s = self._switches.get(key)
            if s is None:
                return singleton
            return singleton * s * s
        gnc = self._factor_weights.get(key, 1.0)
        if self._weight_mode == "gnc":
            return singleton * gnc
        source_id = getattr(factor, "source_id", None)
        if self._reputation_source is not None and source_id is not None:
            r = max(REPUTATION_FLOOR, min(1.0, self._reputation_source(source_id)))
        else:
            r = self._reputation_weights.get(key, 1.0)
        return singleton * r * gnc

    def set_weight_mode(self, mode: str, dcs_phi: float = DCS_PHI_DEFAULT) -> None:
        """Switch the optimizer's per-factor weighting strategy.

        Used by the baseline comparison harness
        (`tests/eval/test_baselines.py`) to A/B specter-1's exogenous-prior
        DCS against pure GNC, pure DCS (Agarwal 2013), and Switchable
        Constraints (Sünderhauf 2012) on the same scenarios. Returns to
        "exogenous" (the production default) when called with mode="exogenous".

        Mode-specific validation: "switchable" requires at least one factor
        to have had `add_switch(factor, γ)` called first — calling
        `set_weight_mode("switchable")` on a graph with no switches raises,
        since the joint optimization would have nothing to switch.
        """
        if mode not in ("exogenous", "gnc", "dcs", "switchable"):
            raise ValueError(f"unknown weight_mode {mode!r}")
        if mode == "switchable" and not self._switchable_factor_keys:
            raise ValueError(
                "weight_mode='switchable' requires at least one factor registered "
                "via add_switch(factor, prior_strength=γ); none found"
            )
        self._weight_mode = mode
        self._dcs_phi = dcs_phi

    def weight_mode(self) -> str:
        return self._weight_mode

    def set_reputation_source(
        self, source: Callable[[str], float] | None
    ) -> None:
        """Live reputation source: a callable `source_id → reputation ∈ [0, 1]`.
        Queried inside `_weight_of` on every assembly, so reputation changes
        between optimize() calls take effect on the next LM step. Pass `None`
        to revert to the frozen-at-insertion fallback.

        Typical wiring: `pg.set_reputation_source(evaluator.reputation)` where
        `evaluator` is a BetaTrustEvaluator. The closure means SLAM sees each
        peer's current rep without coupling PoseGraph to the evaluator type.
        """
        self._reputation_source = source

    def set_reputation_weight(
        self, factor: object, reputation: float
    ) -> None:
        """Set the exogenous-prior reputation weight for a factor (ADR 0018 §1).
        Clamped to [REPUTATION_FLOOR, 1.0]. The frozen-at-insertion path —
        used when no live `_reputation_source` is set, or as an override for
        specific factors (live source takes precedence)."""
        r = max(REPUTATION_FLOOR, min(1.0, reputation))
        self._reputation_weights[self._factor_key(factor)] = r

    def reputation_weights(self) -> dict[str, float]:
        return dict(self._reputation_weights)

    # ---- ADR 0022: provenance + singleton-uniqueness machinery ------------

    def _record_provenance(self, factor: object, tick: int) -> None:
        """Stamp `factor` with a Provenance record. Reputation at insertion
        is read from the same live source / frozen weight that `_weight_of`
        would consult — so the snapshot reflects what the optimizer saw at
        the moment of insertion.
        """
        key = self._factor_key(factor)
        source_id = getattr(factor, "source_id", "")
        if self._reputation_source is not None and source_id:
            r0 = max(REPUTATION_FLOOR, min(1.0, self._reputation_source(source_id)))
        else:
            r0 = self._reputation_weights.get(key, 1.0)
        self._provenance[key] = Provenance(
            reporter_id=source_id,
            insertion_tick=tick,
            reputation_at_insertion=r0,
        )

    def factor_provenance(self, factor: object) -> Provenance:
        """Return the Provenance record for `factor`. Raises KeyError if no
        tick was supplied on add — the substrate is opt-in by ADR 0022 §1.
        """
        return self._provenance[self._factor_key(factor)]

    def set_current_tick(self, tick: int) -> None:
        """Set the simulation tick the optimizer treats as "now" for the
        stale-singleton fade (ADR 0022 §3). Deterministic — there is no
        wall-clock dependence anywhere in the optimizer."""
        self._current_tick = tick

    def enable_singleton_cap(self, enable: bool = True) -> None:
        """Enable the singleton confidence cap (ADR 0022 §2). Off by
        default to preserve the byte-exact parity contract for callers
        that haven't migrated to the provenance API."""
        self._singleton_cap_enabled = enable

    def enable_singleton_fade(self, enable: bool = True) -> None:
        """Enable the stale-singleton fade (ADR 0022 §3). Requires
        `set_current_tick` plus per-factor provenance to do anything."""
        self._singleton_fade_enabled = enable

    def enable_reputation_tracking_gamma(self, enable: bool = True) -> None:
        """Enable reputation-tracking switch prior strength (ADR 0022 §4).
        Only meaningful when `weight_mode = "switchable"`. When on, the
        per-factor γ used inside the SC linearization becomes
        `γ_base · (1 - r_now) · GAMMA_REP_SCALE + GAMMA_FLOOR` instead of
        the static value from `add_switch(prior_strength=γ_base)`. Off by
        default to preserve SC's existing math/parity contract."""
        self._rep_tracking_gamma_enabled = enable

    @staticmethod
    def _source_id_of_key(factor_key: str) -> str:
        """Parse the source_id back out of a factor key. Both
        `lm/.../source_id` and `odom/.../source_id` formats put source_id
        last; we split conservatively from the right to allow other id
        fields to contain slashes (defensive — ids today don't)."""
        return factor_key.rsplit("/", 1)[-1]

    def _effective_gamma(self, factor_key: str) -> float:
        """ADR 0022 §4 effective switch prior strength. Returns the static
        `_switch_priors[key]` when reputation-tracking is off; otherwise
        scales by the reporter's current reputation."""
        gamma_base = self._switch_priors[factor_key]
        if not self._rep_tracking_gamma_enabled:
            return gamma_base
        if self._reputation_source is None:
            return gamma_base
        source_id = self._source_id_of_key(factor_key)
        r = max(REPUTATION_FLOOR, min(1.0, self._reputation_source(source_id)))
        return gamma_base * r * GAMMA_REP_SCALE + GAMMA_FLOOR

    def _landmark_id_of(self, factor: object) -> str | None:
        if isinstance(factor, LandmarkFactor):
            return factor.landmark_id
        return None

    def _singleton_scale(self, factor: object) -> float:
        """Multiplicative scale applied to `Ω_base` from ADR 0022 §§2-3.

        Cap: if the landmark has exactly one distinct reporter and the cap
        is enabled, multiply by `SINGLETON_INFO_SCALE`.
        Fade: if the cap is active AND fade is enabled AND the factor's
        provenance puts `current_tick - insertion_tick > T_CORROBORATE`,
        multiply additionally by the linear ramp `fade(Δt)`.
        Returns 1.0 when neither mechanism applies — preserving parity.
        """
        if not self._singleton_cap_enabled:
            return 1.0
        lm_id = self._landmark_id_of(factor)
        if lm_id is None:
            return 1.0
        reporters = self._landmark_reporters.get(lm_id, set())
        if len(reporters) != 1:
            return 1.0
        scale = SINGLETON_INFO_SCALE
        if self._singleton_fade_enabled and self._current_tick is not None:
            key = self._factor_key(factor)
            prov = self._provenance.get(key)
            if prov is not None:
                delta = self._current_tick - prov.insertion_tick
                if delta > T_CORROBORATE:
                    fade = max(0.0, 1.0 - (delta - T_CORROBORATE) / T_FADE)
                    scale *= fade
        return scale

    # ---- Switchable Constraints (Sünderhauf 2012, weight_mode="switchable") ---

    def add_switch(self, factor: object, prior_strength: float = 1.0) -> None:
        """Register `factor` as switchable. Switch initialized to 1.0 (inlier
        per Sünderhauf §4 default). Takes effect when `weight_mode = "switchable"`.

        The factor must already be registered (added via add_odometry_factor /
        add_landmark_factor / add_inter_robot_factor / add_loop_closure_factor).
        Re-registering the same factor raises (clearer than silent overwrite).

        `prior_strength` is the γ_i parameter in the SC formulation — the
        weight of the prior residual `√γ · (1 - s)` that pulls the switch
        toward inlier. Paper default 1.0; larger values resist switch decay
        on small residuals, smaller values let small residuals dim the
        switch faster.
        """
        if prior_strength <= 0.0:
            raise ValueError(f"prior_strength must be positive, got {prior_strength}")
        key = self._factor_key(factor)
        if not self._factor_exists(key):
            raise ValueError(
                f"factor {key!r} not registered; add the factor first then add_switch"
            )
        if key in self._switch_idx:
            raise ValueError(f"factor {key!r} already has a switch registered")
        self._switch_idx[key] = len(self._switchable_factor_keys)
        self._switchable_factor_keys.append(key)
        self._switches[key] = 1.0
        self._switch_priors[key] = prior_strength

    def switches(self) -> dict[str, float]:
        """Per-factor switch values (∈ [0, 1]) at the current state. Copy —
        external mutation does not affect the optimizer."""
        return dict(self._switches)

    def switch_priors(self) -> dict[str, float]:
        """Per-factor γ (prior strength) values. Copy."""
        return dict(self._switch_priors)

    def _factor_exists(self, key: str) -> bool:
        """True if a factor with this key has been registered (in either
        odometry_factors or landmark_factors). Used by add_switch validation."""
        for fo in self._odometry_factors:
            if self._factor_key(fo) == key:
                return True
        for fl in self._landmark_factors:
            if self._factor_key(fl) == key:
                return True
        return False

    # ADR 0019 — bidirectional trust↔SLAM coupling. Chi-square thresholds for
    # the 2-DOF landmark/inter-robot residual (range + bearing). Per the
    # standard χ² table: F(SLAM_CHISQ_INLIER, 2) = 0.50 (median honest), and
    # F(SLAM_CHISQ_OUTLIER, 2) = 0.95 (95% inlier bound — anything beyond is
    # an outlier under the assumed sensor noise model).

    def slam_residual_evidence(
        self,
        self_id: str | None = None,
    ) -> dict[str, dict[str, float]]:
        """Per-source trust evidence from converged SLAM residuals (ADR 0019).

        Returns `{source_id: {"alpha": x, "beta": y}}` shaped for direct
        consumption by `BetaTrustEvaluator.observe(peer_id, evidence)`.
        Caller is expected to invoke this after `optimize()` converges and
        forward the result into the evaluator.

        Per landmark/inter-robot factor:
          - χ² = rᵀ Ω r  (raw info matrix, no GNC/rep weight applied — we
            want geometric fit, not the weighted cost)
          - χ² ≤ SLAM_CHISQ_INLIER → +alpha 1.0 (corroborates honesty)
          - χ² ≥ SLAM_CHISQ_OUTLIER → +beta 1.0 (factor doesn't fit the
            consensus geometry → source is lying, sensor-faulty, or both)
          - Otherwise: no evidence emitted (residual is between thresholds,
            insufficiently informative — keeps the evaluator quiet on noise)

        Skipped:
          - OdometryFactor: source_id == self → self-incrimination loop
          - LoopClosureFactor: source_id == "loop_closure" → no peer
          - factor source_id == `self_id` if provided (defensive: same as
            odometry skip but for inter-robot factors observing self)

        Stability: invoke once per optimize() cycle. Repeated invocation
        across many cycles re-emits the same evidence — the Beta evaluator's
        exponential decay absorbs short-term redundancy, but production
        wiring should cap emission to once per converged solve.
        """
        evidence: dict[str, dict[str, float]] = {}
        for fl in self._landmark_factors:
            sid = fl.source_id
            if sid == "loop_closure" or sid == self_id:
                continue
            r = _np.array(list(fl.residual(self._poses, self._landmarks)))
            omega = _np.array(fl.info)  # raw info, no weight
            chi_sq = float(r @ omega @ r)
            if chi_sq <= SLAM_CHISQ_INLIER:
                _accumulate_evidence(evidence, sid, alpha=1.0, beta=0.0)
            elif chi_sq >= SLAM_CHISQ_OUTLIER:
                _accumulate_evidence(evidence, sid, alpha=0.0, beta=1.0)
        return evidence

    def total_cost(self) -> float:
        """Σ w · rᵀ Ω r over all factors at current state (w from GNC + reputation)."""
        cost = 0.0
        for fo in self._odometry_factors:
            r = _np.array(list(fo.residual(self._poses)))
            omega = _np.array(fo.info) * self._weight_of(fo)
            cost += float(r @ omega @ r)
        for fl in self._landmark_factors:
            r = _np.array(list(fl.residual(self._poses, self._landmarks)))
            omega = _np.array(fl.info) * self._weight_of(fl)
            cost += float(r @ omega @ r)
        return cost

    # ---- LM linearization + step ----------------------------------------

    def _assemble_normal_equations(self) -> tuple[_np.ndarray, _np.ndarray]:
        """Build H = Σ JᵀΩJ and g = Σ JᵀΩr at the current linearization point.

        In `weight_mode = "switchable"` (SC), switchable factors additionally
        contribute switch-coupling terms per Sünderhauf §3-4:
          H_xs += s · Jᵀ Ω r          (cross-block between state and switch)
          H_ss += rᵀ Ω r + γ          (switch diagonal: data + prior)
          g_s  += s · rᵀ Ω r - γ(1-s) (switch gradient: data + prior)
        The state-state H_xx and state gradient g_x are handled by the
        existing `_accumulate` path with omega = s² · Ω (returned by
        `_weight_of` in SC mode), so the SC fork only adds the s-coupling.
        """
        n = self._state_dim()
        h = _np.zeros((n, n))
        g = _np.zeros(n)
        is_sc = self._weight_mode == "switchable"

        for fo in self._odometry_factors:
            t_i = self._poses[fo.from_id]
            t_j = self._poses[fo.to_id]
            raw_omega = _np.array(fo.info)
            omega = raw_omega * self._weight_of(fo)
            r_tup = fo.residual(self._poses)
            r = _np.array(list(r_tup))
            j_i_full, j_j_full = _analytic_jac_relative_pose(t_i, t_j, r_tup)
            j_i = j_i_full if fo.from_id != self._anchor_pose_id else None
            j_j = j_j_full if fo.to_id != self._anchor_pose_id else None
            slot_i = self._pose_slot(fo.from_id)
            slot_j = self._pose_slot(fo.to_id)
            odo_blocks: list[tuple[_np.ndarray | None, int | None, int]] = [
                (j_i, slot_i, 3),
                (j_j, slot_j, 3),
            ]
            self._accumulate(h, g, omega, r, odo_blocks)
            if is_sc:
                key = self._factor_key(fo)
                if key in self._switch_idx:
                    self._accumulate_sc_switch_terms(h, g, key, raw_omega, r, odo_blocks)

        for fl in self._landmark_factors:
            t = self._poses[fl.pose_id]
            lm = self._landmarks[fl.landmark_id]
            raw_omega = _np.array(fl.info)
            omega = raw_omega * self._weight_of(fl)
            r = _np.array(list(fl.residual(self._poses, self._landmarks)))
            j_p_full, j_l = _analytic_jac_landmark(t, lm)
            j_p = j_p_full if fl.pose_id != self._anchor_pose_id else None
            slot_p = self._pose_slot(fl.pose_id)
            slot_l = self._landmark_slot(fl.landmark_id)
            lm_blocks: list[tuple[_np.ndarray | None, int | None, int]] = [
                (j_p, slot_p, 3),
                (j_l, slot_l, 2),
            ]
            self._accumulate(h, g, omega, r, lm_blocks)
            if is_sc:
                key = self._factor_key(fl)
                if key in self._switch_idx:
                    self._accumulate_sc_switch_terms(h, g, key, raw_omega, r, lm_blocks)

        return h, g

    def _accumulate_sc_switch_terms(
        self,
        h: _np.ndarray,
        g: _np.ndarray,
        factor_key: str,
        raw_omega: _np.ndarray,
        r: _np.ndarray,
        state_blocks: list[tuple[_np.ndarray | None, int | None, int]],
    ) -> None:
        """Add SC switch-coupling terms to H, g for one switchable factor.

        Per the SC linearization at (x_0, s_0) for one factor:
          e_data = s · r(x)          → ∂e_data/∂δ_s = r(x_0); ∂e_data/∂δ_x = s · J_x
          e_prior = √γ · (1 - s)     → ∂e_prior/∂δ_s = -√γ

        Contributions (data + prior) NOT already accumulated by the state-only
        `_accumulate(omega = s² · Ω, r=r(x))` call above:
          H_xs += s · J_xᵀ Ω r        (one entry per state block)
          H_sx += s · rᵀ Ω J_x        (symmetric transpose)
          H_ss += rᵀ Ω r + γ          (diagonal: data + prior)
          g_s  += s · rᵀ Ω r − γ(1 − s)
        """
        s = self._switches[factor_key]
        gamma = self._effective_gamma(factor_key)
        slot_s = self._switch_slot(factor_key)
        omega_r = raw_omega @ r  # (dim_r,)
        chi_unweighted = float(r @ omega_r)
        # Switch diagonal H_ss: data + prior
        h[slot_s, slot_s] += chi_unweighted + gamma
        # Switch gradient g_s: data + prior
        g[slot_s] += s * chi_unweighted - gamma * (1.0 - s)
        # Cross-coupling H_xs / H_sx between each state block and the switch
        for j_x, slot_x, dim_x in state_blocks:
            if j_x is None or slot_x is None:
                continue
            cross = s * (j_x.T @ omega_r)  # (dim_x,)
            h[slot_x : slot_x + dim_x, slot_s] += cross
            h[slot_s, slot_x : slot_x + dim_x] += cross

    @staticmethod
    def _accumulate(
        h: _np.ndarray,
        g: _np.ndarray,
        omega: _np.ndarray,
        r: _np.ndarray,
        blocks: list[tuple[_np.ndarray | None, int | None, int]],
    ) -> None:
        """H_ii += Jᵢᵀ Ω Jᵢ; H_ij += Jᵢᵀ Ω Jⱼ; g_i += Jᵢᵀ Ω r."""
        for j_a, slot_a, dim_a in blocks:
            if j_a is None or slot_a is None:
                continue
            g[slot_a : slot_a + dim_a] += j_a.T @ omega @ r
            for j_b, slot_b, dim_b in blocks:
                if j_b is None or slot_b is None:
                    continue
                h[slot_a : slot_a + dim_a, slot_b : slot_b + dim_b] += j_a.T @ omega @ j_b

    def _apply_step(self, delta: _np.ndarray) -> None:
        """Update poses (right perturbation), landmarks (Euclidean), and
        switches (additive + [0,1] clamping per SC §4) from δ.

        Switch clamping breaks the -δ revert round-trip when a step crosses
        the [0,1] boundary, so we snapshot pre-step values into
        `_switch_pre_step` for exact restoration in `_revert_step`."""
        for pose_id in self._free_pose_ids():
            slot = self._pose_slot(pose_id)
            assert slot is not None
            xi_list = delta[slot : slot + 3].tolist()
            dxi: tuple[float, float, float] = (xi_list[0], xi_list[1], xi_list[2])
            self._poses[pose_id] = compose(self._poses[pose_id], exp_se2(dxi))
        for landmark_id in self._landmark_ids:
            slot = self._landmark_slot(landmark_id)
            dlm = delta[slot : slot + 2]
            lx, ly = self._landmarks[landmark_id]
            self._landmarks[landmark_id] = (lx + float(dlm[0]), ly + float(dlm[1]))
        # Switch tail (SC mode only — empty in other modes).
        if self._switchable_factor_keys:
            base = self._switch_tail_base()
            self._switch_pre_step = {k: self._switches[k] for k in self._switchable_factor_keys}
            for i, key in enumerate(self._switchable_factor_keys):
                raw = self._switches[key] + float(delta[base + i])
                self._switches[key] = max(0.0, min(1.0, raw))

    def _revert_step(self, delta: _np.ndarray) -> None:
        """Undo `_apply_step` — for LM step rejection. Poses + landmarks
        revert via -δ (exact for SE(2) right perturbation + Euclidean
        addition); switches restore from the pre-step snapshot to avoid
        clamping-induced drift."""
        # Pose + landmark revert via -δ (exact).
        for pose_id in self._free_pose_ids():
            slot = self._pose_slot(pose_id)
            assert slot is not None
            xi_list = (-delta[slot : slot + 3]).tolist()
            dxi: tuple[float, float, float] = (xi_list[0], xi_list[1], xi_list[2])
            self._poses[pose_id] = compose(self._poses[pose_id], exp_se2(dxi))
        for landmark_id in self._landmark_ids:
            slot = self._landmark_slot(landmark_id)
            dlm = delta[slot : slot + 2]
            lx, ly = self._landmarks[landmark_id]
            self._landmarks[landmark_id] = (lx - float(dlm[0]), ly - float(dlm[1]))
        # Switch restore (exact, dodges clamping).
        if self._switchable_factor_keys and self._switch_pre_step:
            for key, v in self._switch_pre_step.items():
                self._switches[key] = v

    def optimize(self) -> None:
        """Run LM with adaptive damping per ADR 0016 §7–§9."""
        if self._state_dim() == 0:
            self._iterations_last_run = 0
            self._final_cost = self.total_cost()
            return

        prev_cost = self.total_cost()
        h0, _ = self._assemble_normal_equations()
        lam = LM_INITIAL_LAMBDA_SCALE * float(_np.max(_np.diag(h0))) if h0.size else LM_INITIAL_LAMBDA_SCALE
        if lam == 0.0:
            lam = LM_INITIAL_LAMBDA_SCALE

        last_accepted_step = False
        for it in range(LM_MAX_ITERATIONS):
            h, g = self._assemble_normal_equations()
            damped = h + lam * _np.eye(h.shape[0])
            try:
                # Cholesky factorization for PSD damped Hessian; solve via the
                # factors. Sparse + AMD swap-in lands in Wave 1.5; the outer
                # loop is unchanged.
                l_chol = _np.linalg.cholesky(damped)
                y = _np.linalg.solve(l_chol, -g)
                delta = _np.linalg.solve(l_chol.T, y)
            except _np.linalg.LinAlgError:
                lam = min(lam * LM_LAMBDA_UP, LM_LAMBDA_MAX)
                continue

            self._apply_step(delta)
            new_cost = self.total_cost()

            if new_cost < prev_cost:
                # Step accepted.
                last_accepted_step = True
                delta_inf = float(_np.max(_np.abs(delta)))
                cost_ratio = (prev_cost - new_cost) / max(prev_cost, 1.0e-30)
                lam = max(lam / LM_LAMBDA_DOWN, 1.0e-12)
                prev_cost = new_cost
                if delta_inf < LM_CONVERGE_DELTA and cost_ratio < LM_CONVERGE_COST_RATIO and last_accepted_step:
                    self._iterations_last_run = it + 1
                    self._final_cost = new_cost
                    return
            else:
                # Step rejected.
                self._revert_step(delta)
                last_accepted_step = False
                lam = min(lam * LM_LAMBDA_UP, LM_LAMBDA_MAX)

        self._iterations_last_run = LM_MAX_ITERATIONS
        self._final_cost = prev_cost

    # ---- GNC outer loop (Wave 1.4) --------------------------------------

    def _factor_mahalanobis_sq(self, factor: object) -> float:
        """χ² = rᵀ Ω₀ r at base information (no GNC/reputation weight applied)."""
        if isinstance(factor, OdometryFactor):
            r = _np.array(factor.residual(self._poses))
        elif isinstance(factor, LandmarkFactor):
            r = _np.array(factor.residual(self._poses, self._landmarks))
        else:
            raise TypeError(f"unknown factor type: {type(factor)!r}")
        omega = _np.array(factor.info)
        return float(r @ omega @ r)

    def _all_factors(self) -> list[object]:
        return [*self._odometry_factors, *self._landmark_factors]

    def _compute_initial_mu(self) -> float:
        """μ₀ = 2 · max_i(χ²_i) / c̄² per Yang 2020 §IV.A."""
        factors = self._all_factors()
        if not factors:
            return 1.0
        max_chi_sq = max(self._factor_mahalanobis_sq(f) for f in factors)
        # Floor at 1.0 to guarantee the initial μ is large enough that all
        # factors start as effective inliers (Geman-McClure ≈ squared loss).
        return max(2.0 * max_chi_sq / (GNC_C_BAR * GNC_C_BAR), 1.0)

    def _update_gnc_weights(self, mu: float) -> dict[str, float]:
        """w_i = (μ / (μ + χ²_i))² per Yang 2020 §IV.A (Geman-McClure)."""
        new_weights: dict[str, float] = {}
        for f in self._all_factors():
            chi_sq = self._factor_mahalanobis_sq(f)
            denom = mu + chi_sq
            w = (mu / denom) ** 2 if denom > 0 else 0.0
            new_weights[self._factor_key(f)] = w
        return new_weights

    def optimize_gnc(self) -> None:
        """LM + Geman-McClure GNC per ADR 0016 §7–§8. Outer loop decays μ until
        weight classes stabilize or μ falls below GNC_MU_FLOOR; inner LM runs
        to convergence at each μ level.

        Composition with reputation prior (Wave 4): if the caller has set
        per-factor reputation weights via `set_reputation_weight(...)`, the
        effective per-iteration weight is `r · w_gnc · Ω` (multiplicative
        composition, frozen-at-insertion per ADR 0016 §4). Wave 4 will add
        the `set_reputation_weight` API; here GNC is the only weight source.
        """
        if not self._all_factors():
            self.optimize()
            self._gnc_outer_iters_last_run = 0
            return

        mu = self._compute_initial_mu()
        # Reset GNC weights (preserve any externally-set reputation weights
        # — Wave 4 will keep them in a parallel dict; for now they coexist).
        self._factor_weights = self._update_gnc_weights(mu)
        prev_weights = dict(self._factor_weights)

        for outer in range(GNC_MAX_OUTER_ITER):
            self.optimize()  # inner LM with current weights
            mu = max(mu / GNC_MU_DECAY, 0.0)
            if mu < GNC_MU_FLOOR:
                self._gnc_outer_iters_last_run = outer + 1
                return
            self._factor_weights = self._update_gnc_weights(mu)
            max_change = max(
                abs(self._factor_weights[k] - prev_weights.get(k, 1.0))
                for k in self._factor_weights
            )
            if max_change < GNC_WEIGHT_CHANGE_TAU:
                self.optimize()  # final inner solve at converged weights
                self._gnc_outer_iters_last_run = outer + 1
                return
            prev_weights = dict(self._factor_weights)
        self._gnc_outer_iters_last_run = GNC_MAX_OUTER_ITER

    def gnc_weights(self) -> dict[str, float]:
        """Snapshot of per-factor GNC weights after most recent optimize_gnc()."""
        return dict(self._factor_weights)

    @property
    def gnc_outer_iters_last_run(self) -> int:
        return self._gnc_outer_iters_last_run

    # ---- accessors (PoseGraphSlam ABC compatibility) ---------------------

    def trajectory(self) -> list[tuple[str, Pose2]]:
        return [(pid, self._poses[pid]) for pid in self._pose_ids]

    def landmarks(self) -> dict[str, tuple[float, float]]:
        return dict(self._landmarks)

    @property
    def iterations_last_run(self) -> int:
        return self._iterations_last_run

    @property
    def final_cost(self) -> float:
        return self._final_cost
