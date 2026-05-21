"""ADR 0016 Wave 1.1 — SE(2) Lie group primitives.

Verifies group axioms (closure, associativity, identity, inverse) and
Lie-group invariants (exp/log round-trip, right-Jacobian small-angle
limit). Parity vs the TS port is gated separately by the cross-platform
parity fixture in `ui/packages/sim-core/tests/poseGraph.parity.test.ts`.
"""

import math

import pytest

from specter.slam.pose_graph import (
    IDENTITY,
    SE2_SMALL_ANGLE_TAU,
    Pose2,
    between,
    compose,
    exp_se2,
    inverse,
    log_se2,
    right_jacobian_se2,
    wrap_angle,
)


def _close(a: float, b: float, tol: float = 1.0e-10) -> bool:
    return abs(a - b) <= tol


def _pose_close(a: Pose2, b: Pose2, tol: float = 1.0e-10) -> bool:
    return _close(a.x, b.x, tol) and _close(a.y, b.y, tol) and _close(a.theta, b.theta, tol)


# ---- wrap_angle -------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,wrapped",
    [
        (0.0, 0.0),
        (math.pi / 4, math.pi / 4),
        (math.pi, math.pi),
        (-math.pi, math.pi),  # canonical (-π, π]
        (3 * math.pi, math.pi),
        (-3 * math.pi, math.pi),
        (2 * math.pi + 0.5, 0.5),
    ],
)
def test_wrap_angle_canonical_range(raw: float, wrapped: float):
    assert _close(wrap_angle(raw), wrapped)


# ---- group axioms -----------------------------------------------------------


def test_compose_with_identity_is_no_op():
    a = Pose2(1.5, -0.7, 0.4)
    assert _pose_close(compose(a, IDENTITY), a)
    assert _pose_close(compose(IDENTITY, a), a)


def test_compose_with_inverse_yields_identity():
    a = Pose2(1.5, -0.7, 0.4)
    c = compose(a, inverse(a))
    assert _close(c.x, 0.0)
    assert _close(c.y, 0.0)
    assert _close(c.theta, 0.0)


def test_compose_is_associative():
    a = Pose2(1.0, 0.5, 0.3)
    b = Pose2(-0.2, 1.0, -0.4)
    c = Pose2(0.7, -0.3, 0.9)
    left = compose(compose(a, b), c)
    right = compose(a, compose(b, c))
    assert _pose_close(left, right, tol=1.0e-12)


def test_between_then_compose_reconstructs_b():
    a = Pose2(1.0, 0.5, 0.7)
    b = Pose2(0.3, -0.2, 0.1)
    rel = between(a, b)
    assert _pose_close(compose(a, rel), b)


# ---- exp / log round-trip ---------------------------------------------------


@pytest.mark.parametrize(
    "xi",
    [
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 0.1),
        (0.5, 0.3, 0.7),
        (-1.2, 0.8, -0.45),
        (2.0, -1.0, 2.9),
    ],
)
def test_log_exp_is_identity_on_tangent(xi: tuple[float, float, float]):
    """log(exp(ξ)) == ξ for any tangent vector (within the canonical wrap on θ)."""
    pose = exp_se2(xi)
    xi_back = log_se2(pose)
    assert _close(xi_back[0], xi[0])
    assert _close(xi_back[1], xi[1])
    assert _close(xi_back[2], wrap_angle(xi[2]))


@pytest.mark.parametrize(
    "pose",
    [
        Pose2(0.0, 0.0, 0.0),
        Pose2(1.0, 2.0, 0.5),
        Pose2(-0.3, 0.7, -1.2),
        Pose2(2.5, -1.1, 0.01),
    ],
)
def test_exp_log_is_identity_on_pose(pose: Pose2):
    """exp(log(T)) == T for any pose."""
    back = exp_se2(log_se2(pose))
    assert _pose_close(back, pose)


# ---- small-angle branch -----------------------------------------------------


def test_exp_small_angle_branch_matches_general_at_threshold():
    """Continuity check: at θ just under the small-angle threshold, the
    Taylor branch and the general formula agree to better than the parity
    tolerance. Guards against a step discontinuity at SE2_SMALL_ANGLE_TAU."""
    theta_small = 0.9 * SE2_SMALL_ANGLE_TAU  # uses Taylor
    theta_just_over = 1.1 * SE2_SMALL_ANGLE_TAU  # uses general formula
    rho = (0.5, -0.3)
    p_small = exp_se2((rho[0], rho[1], theta_small))
    p_over = exp_se2((rho[0], rho[1], theta_just_over))
    # Pose components vary smoothly across the branch — values differ only by
    # the θ-step itself, which is 0.2 × 1e-5 = 2e-6.
    assert _close(p_small.x, p_over.x, tol=1.0e-5)
    assert _close(p_small.y, p_over.y, tol=1.0e-5)


def test_log_small_angle_branch_matches_general_at_threshold():
    theta_small = 0.9 * SE2_SMALL_ANGLE_TAU
    theta_just_over = 1.1 * SE2_SMALL_ANGLE_TAU
    p_small = Pose2(0.5, -0.3, theta_small)
    p_over = Pose2(0.5, -0.3, theta_just_over)
    xi_small = log_se2(p_small)
    xi_over = log_se2(p_over)
    assert _close(xi_small[0], xi_over[0], tol=1.0e-5)
    assert _close(xi_small[1], xi_over[1], tol=1.0e-5)


# ---- right Jacobian (Polish A) ---------------------------------------------


def _numeric_inv_right_jacobian_se2(
    xi: tuple[float, float, float], eps: float = 1.0e-6
) -> list[list[float]]:
    """Numeric ground truth: J_r^{-1}(ξ) = ∂(log(exp(ξ) ⊕ exp(δ))) / ∂δ |_{δ=0}
    via central difference. Used to validate the closed-form J_r."""
    base_pose = exp_se2(xi)
    j_inv: list[list[float]] = [[0.0] * 3 for _ in range(3)]
    for k in range(3):
        d_plus = [0.0, 0.0, 0.0]
        d_plus[k] = eps
        d_minus = [0.0, 0.0, 0.0]
        d_minus[k] = -eps
        xi_p_plus = (d_plus[0], d_plus[1], d_plus[2])
        xi_p_minus = (d_minus[0], d_minus[1], d_minus[2])
        log_plus = log_se2(compose(base_pose, exp_se2(xi_p_plus)))
        log_minus = log_se2(compose(base_pose, exp_se2(xi_p_minus)))
        for i in range(3):
            j_inv[i][k] = (log_plus[i] - log_minus[i]) / (2.0 * eps)
    return j_inv


def _matmul3(a: tuple, b: list) -> list[list[float]]:
    """3x3 matrix multiply a × b."""
    out = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            for k in range(3):
                out[i][j] += a[i][k] * b[k][j]
    return out


def test_right_jacobian_at_identity_is_identity():
    """J_r(0) = I_3."""
    jr = right_jacobian_se2((0.0, 0.0, 0.0))
    for i in range(3):
        for j in range(3):
            expected = 1.0 if i == j else 0.0
            assert _close(jr[i][j], expected)


def test_right_jacobian_bottom_row_is_always_001():
    """SE(2) right Jacobian bottom row is (0, 0, 1) because SO(2) is 1-D."""
    for xi in [(0.0, 0.0, 0.5), (1.0, 0.0, 0.3), (-0.5, 0.7, -1.2), (0.0, 0.0, 1.0e-7)]:
        jr = right_jacobian_se2(xi)
        assert _close(jr[2][0], 0.0)
        assert _close(jr[2][1], 0.0)
        assert _close(jr[2][2], 1.0)


@pytest.mark.parametrize(
    "xi",
    [
        (1.0, 0.5, 0.7),
        (-1.2, 0.8, -0.45),
        (2.0, -1.0, 2.9),
        (0.5, 0.3, 0.1),
        (0.0, 1.0, 1.5),
        (1.0, 0.0, -2.0),
        (0.1, -0.1, 0.5),
    ],
)
def test_right_jacobian_matches_numeric_inv_then_inverted(xi: tuple[float, float, float]):
    """J_r(ξ) is the inverse of the numeric J_r^{-1}(ξ). Compute J_r^{-1} from
    central differences of log(exp(ξ) ⊕ exp(δ)) w.r.t. δ; verify J_r · J_r^{-1} = I."""
    j_inv = _numeric_inv_right_jacobian_se2(xi)
    jr = right_jacobian_se2(xi)
    product = _matmul3(jr, j_inv)
    for i in range(3):
        for j in range(3):
            expected = 1.0 if i == j else 0.0
            assert _close(product[i][j], expected, tol=1.0e-5), (
                f"J_r · J_r^-1 [{i},{j}] = {product[i][j]} ≠ {expected} at ξ={xi}"
            )


def test_right_jacobian_small_angle_continuity():
    """Closed-form values agree at the small/large branch boundary to 1e-5."""
    rho = (0.5, -0.3)
    j_small = right_jacobian_se2((rho[0], rho[1], 0.9 * SE2_SMALL_ANGLE_TAU))
    j_over = right_jacobian_se2((rho[0], rho[1], 1.1 * SE2_SMALL_ANGLE_TAU))
    for i in range(3):
        for j in range(3):
            assert _close(j_small[i][j], j_over[i][j], tol=1.0e-5)
