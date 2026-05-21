"""Switchable Constraints math correctness (SC_PLAN Wave 2) — load-bearing.

The Wave 2 assembly fork is the most error-prone code in the SC slice (sign
errors hide here exactly like they did in the SE(2) adjoint). The
analytic-vs-numeric Jacobian test on a toy graph is the correctness gate;
the equivalence-at-s=1 test and the zero-data-at-s=0 test add coverage of
the boundary degeneracies.

These tests pass = SC math is wired correctly. They fail = stop and debug
the Jacobian before any baseline-comparison work."""

from __future__ import annotations

import numpy as np

from specter.slam.pose_graph import (
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)

EPS = 1.0e-6


def _toy_two_factor_graph(s_a: float = 1.0, s_b: float = 1.0) -> tuple[
    PoseGraph, LandmarkFactor, LandmarkFactor
]:
    """Pose at origin, landmark truth (5, 0), 2 honest landmark observations
    from sources A and B. Both factors are registered as switchable; switch
    values can be overridden by the caller."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (5.0, 0.0))
    fa = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="A",
    )
    fb = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=4.5, bearing_rad=0.05,  # slight residual
        info=landmark_information(5.0),
        source_id="B",
    )
    pg.add_landmark_factor(fa)
    pg.add_landmark_factor(fb)
    pg.add_switch(fa, prior_strength=1.0)
    pg.add_switch(fb, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    # Move landmark off truth so residuals are nonzero
    pg._landmarks["lm0"] = (4.7, 0.1)
    pg._switches[pg._factor_key(fa)] = s_a
    pg._switches[pg._factor_key(fb)] = s_b
    return pg, fa, fb


# ---------------------------------------------------------------------------
# H, g shape extends correctly when switchable mode is active
# ---------------------------------------------------------------------------


def test_assembly_extends_normal_equations_by_switch_count():
    pg, _, _ = _toy_two_factor_graph()
    h, g = pg._assemble_normal_equations()
    # p0 gauge-fixed, lm0 has 2 DOF, 2 switches → state_dim = 4
    assert h.shape == (4, 4)
    assert g.shape == (4,)


# ---------------------------------------------------------------------------
# Boundary degeneracy: at s=1 everywhere AND γ→∞, SC reduces to bare LM
# on the data block. (γ=1 here, so the switch prior contributes meaningfully —
# we test the data-only piece by comparing to the gnc-mode H_xx block.)
# ---------------------------------------------------------------------------


def test_switchable_at_s_equals_one_data_block_matches_gnc_mode():
    """With s=1 everywhere, the state-state block H_xx of the SC assembly
    equals the same block under weight_mode='gnc'. The SC switch tail adds
    extra rows/cols; the state-state block alone is the comparison point."""
    pg_sc, _, _ = _toy_two_factor_graph(s_a=1.0, s_b=1.0)
    h_sc, g_sc = pg_sc._assemble_normal_equations()

    # Reset to gnc mode (no switches active).
    pg_gnc = PoseGraph()
    pg_gnc.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg_gnc.add_landmark("lm0", (4.7, 0.1))  # same offset as SC graph
    fa = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="A",
    )
    fb = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=4.5, bearing_rad=0.05,
        info=landmark_information(5.0),
        source_id="B",
    )
    pg_gnc.add_landmark_factor(fa)
    pg_gnc.add_landmark_factor(fb)
    pg_gnc.set_weight_mode("gnc")
    h_gnc, g_gnc = pg_gnc._assemble_normal_equations()

    # state_dim for gnc graph is 2 (just lm0). For SC graph it's 4 (lm0 + 2 switches).
    # Compare the lm-lm block.
    np.testing.assert_allclose(h_sc[:2, :2], h_gnc[:2, :2], atol=1e-10)
    np.testing.assert_allclose(g_sc[:2], g_gnc[:2], atol=1e-10)


# ---------------------------------------------------------------------------
# Boundary degeneracy: at s=0 for one factor, that factor's contribution to
# state-block H and g vanishes; only the prior is left for the switch slot.
# ---------------------------------------------------------------------------


def test_switchable_at_s_equals_zero_kills_data_contribution():
    """With s_a=0, factor A contributes nothing to the state-state block of H
    or to g_x. Factor B still contributes normally. Switch column for A only
    carries the prior γ on the diagonal and -γ(1-s)=-γ on g_s."""
    # SC with both switches at 1 (baseline)
    pg_both, fa, _ = _toy_two_factor_graph(s_a=1.0, s_b=1.0)
    h_both, g_both = pg_both._assemble_normal_equations()

    # SC with switch_a = 0
    pg_off, fa2, _ = _toy_two_factor_graph(s_a=0.0, s_b=1.0)
    h_off, g_off = pg_off._assemble_normal_equations()

    # Removing factor A's data contribution should reduce the lm-lm H block.
    # Specifically: h_both[:2,:2] = (s_a²) · J_aᵀΩJ_a + (s_b²) · J_bᵀΩJ_b
    # h_off[:2,:2] = 0 + (s_b²) · J_bᵀΩJ_b
    # diff = h_both[:2,:2] - h_off[:2,:2] should equal J_aᵀΩJ_a
    diff_h = h_both[:2, :2] - h_off[:2, :2]
    # Standalone graph with just fa to compute J_aᵀΩJ_a:
    pg_solo_a = PoseGraph()
    pg_solo_a.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg_solo_a.add_landmark("lm0", (4.7, 0.1))
    pg_solo_a.add_landmark_factor(LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0), source_id="A",
    ))
    pg_solo_a.set_weight_mode("gnc")
    h_solo_a, _ = pg_solo_a._assemble_normal_equations()
    np.testing.assert_allclose(diff_h, h_solo_a, atol=1e-10)

    # Switch slot for A (index 0 in switch tail; state_dim=4, so slot=2):
    sw_slot_a = pg_off._switch_slot(pg_off._factor_key(fa2))
    # At s_a=0, prior contributes γ=1 to H[ss], data contributes rᵀΩr.
    # We can't pin down rᵀΩr without computing it; verify the diagonal is at
    # least γ (the prior contribution is always present).
    assert h_off[sw_slot_a, sw_slot_a] >= 1.0


# ---------------------------------------------------------------------------
# THE LOAD-BEARING TEST: analytic vs numeric Jacobian on the augmented
# residual e(x, s) = [s·r(x); √γ·(1-s)].
# ---------------------------------------------------------------------------


def _augmented_residual_and_jacobian_numeric(pg: PoseGraph) -> tuple[np.ndarray, np.ndarray]:
    """Compute the stacked SC augmented residual e_aug and its FULL numeric
    Jacobian w.r.t. the state vector [δ_x; δ_s] by central differences.
    Used to validate the analytic assembly."""
    # Snapshot current state
    lm_pre = dict(pg._landmarks)
    sw_pre = dict(pg._switches)

    def augmented_residual() -> np.ndarray:
        rows: list[float] = []
        # Data residuals (s · r(x))
        for f in pg._landmark_factors:
            key = pg._factor_key(f)
            s = pg._switches[key]
            r = np.array(list(f.residual(pg._poses, pg._landmarks)))
            rows.extend(s * r)
        # Prior residuals (√γ · (1 - s)) — one per switchable factor in
        # insertion order
        for key in pg._switchable_factor_keys:
            gamma = pg._switch_priors[key]
            s = pg._switches[key]
            rows.append(np.sqrt(gamma) * (1.0 - s))
        return np.array(rows)

    e0 = augmented_residual()
    n_state = pg._state_dim()
    j = np.zeros((len(e0), n_state))

    # Differentiate w.r.t. landmark slots (2 DOF for lm0)
    for k in range(2):
        lm_id = pg._landmark_ids[0]
        slot = pg._landmark_slot(lm_id)
        # +eps
        lx, ly = lm_pre[lm_id]
        if k == 0:
            pg._landmarks[lm_id] = (lx + EPS, ly)
        else:
            pg._landmarks[lm_id] = (lx, ly + EPS)
        e_plus = augmented_residual()
        # -eps
        if k == 0:
            pg._landmarks[lm_id] = (lx - EPS, ly)
        else:
            pg._landmarks[lm_id] = (lx, ly - EPS)
        e_minus = augmented_residual()
        pg._landmarks[lm_id] = (lx, ly)  # restore
        j[:, slot + k] = (e_plus - e_minus) / (2.0 * EPS)

    # Differentiate w.r.t. switch slots
    for i, key in enumerate(pg._switchable_factor_keys):
        slot = pg._switch_slot(key)
        s_pre = sw_pre[key]
        pg._switches[key] = s_pre + EPS
        e_plus = augmented_residual()
        pg._switches[key] = s_pre - EPS
        e_minus = augmented_residual()
        pg._switches[key] = s_pre
        j[:, slot] = (e_plus - e_minus) / (2.0 * EPS)

    return e0, j


def test_analytic_assembly_matches_numeric_jacobian_at_inlier_point():
    """Build H = JᵀΩ_aug J and g = JᵀΩ_aug e from the numeric Jacobian +
    augmented residual; compare to the analytic _assemble_normal_equations
    output. Tolerance 1e-6 absolute (numeric central-diff floor)."""
    pg, _, _ = _toy_two_factor_graph(s_a=0.9, s_b=0.7)

    # Analytic H, g from assembly fork
    h_analytic, g_analytic = pg._assemble_normal_equations()

    # Numeric reference
    e_aug, j_aug = _augmented_residual_and_jacobian_numeric(pg)
    # Build the augmented info matrix: block-diag(Ω_data_1, Ω_data_2, γ_1, γ_2)
    om_blocks: list[np.ndarray] = []
    for f in pg._landmark_factors:
        om_blocks.append(np.array(f.info))
    for key in pg._switchable_factor_keys:
        om_blocks.append(np.array([[pg._switch_priors[key]]]))
    # Block-diag construction
    total_rows = sum(b.shape[0] for b in om_blocks)
    omega_aug = np.zeros((total_rows, total_rows))
    cursor = 0
    for b in om_blocks:
        d = b.shape[0]
        omega_aug[cursor:cursor + d, cursor:cursor + d] = b
        cursor += d

    h_numeric = j_aug.T @ omega_aug @ j_aug
    g_numeric = j_aug.T @ omega_aug @ e_aug
    np.testing.assert_allclose(h_analytic, h_numeric, atol=1e-6, rtol=1e-6)
    np.testing.assert_allclose(g_analytic, g_numeric, atol=1e-6, rtol=1e-6)


def test_analytic_assembly_matches_numeric_jacobian_with_one_switch_at_zero():
    """Repeat at s_a=0.05, s_b=0.95 — covers the cross-block H_xs/H_sx
    asymmetry when one factor's data contribution is nearly muted."""
    pg, _, _ = _toy_two_factor_graph(s_a=0.05, s_b=0.95)
    h_analytic, g_analytic = pg._assemble_normal_equations()
    e_aug, j_aug = _augmented_residual_and_jacobian_numeric(pg)
    om_blocks: list[np.ndarray] = []
    for f in pg._landmark_factors:
        om_blocks.append(np.array(f.info))
    for key in pg._switchable_factor_keys:
        om_blocks.append(np.array([[pg._switch_priors[key]]]))
    total_rows = sum(b.shape[0] for b in om_blocks)
    omega_aug = np.zeros((total_rows, total_rows))
    cursor = 0
    for b in om_blocks:
        d = b.shape[0]
        omega_aug[cursor:cursor + d, cursor:cursor + d] = b
        cursor += d
    h_numeric = j_aug.T @ omega_aug @ j_aug
    g_numeric = j_aug.T @ omega_aug @ e_aug
    np.testing.assert_allclose(h_analytic, h_numeric, atol=1e-6, rtol=1e-6)
    np.testing.assert_allclose(g_analytic, g_numeric, atol=1e-6, rtol=1e-6)


def test_assembly_hessian_is_symmetric():
    """H must be exactly symmetric (cross-block H_xs and H_sx are transposes)."""
    pg, _, _ = _toy_two_factor_graph(s_a=0.7, s_b=0.3)
    h, _ = pg._assemble_normal_equations()
    np.testing.assert_allclose(h, h.T, atol=1e-12)


# ---------------------------------------------------------------------------
# End-to-end: SC actually recovers the landmark on the lying-landmark scenario
# (this is the Wave 3 acceptance test, but a smoke version lives here to gate
# the math before baselines integrate)
# ---------------------------------------------------------------------------


def test_switchable_constraints_recovers_landmark_smoke():
    """3 honest landmark observations + 1 lying observation. SC should converge
    the liar's switch toward 0 and the landmark estimate toward truth."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))  # initial guess off
    honest = []
    for i in range(3):
        f = LandmarkFactor(
            pose_id="p0", landmark_id="lm0",
            range_m=5.0, bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(f)
        pg.add_switch(f, prior_strength=1.0)
        honest.append(f)
    liar = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=10.0, bearing_rad=0.0,  # lying
        info=landmark_information(5.0),
        source_id="liar",
    )
    pg.add_landmark_factor(liar)
    pg.add_switch(liar, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    pg.optimize()

    lm = pg.landmarks()["lm0"]
    assert abs(lm[0] - 5.0) < 1.0, f"landmark x={lm[0]:.3f}, want close to 5"
    liar_switch = pg.switches()[pg._factor_key(liar)]
    assert liar_switch < 0.5, f"liar switch={liar_switch:.3f}, want < 0.5"


def test_switchable_constraints_keeps_honest_switches_high():
    """Companion to the recovery test: honest factors' switches should stay
    near 1.0 since their residuals fit the consensus."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))
    honest = []
    for i in range(3):
        f = LandmarkFactor(
            pose_id="p0", landmark_id="lm0",
            range_m=5.0, bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(f)
        pg.add_switch(f, prior_strength=1.0)
        honest.append(f)
    liar = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=10.0, bearing_rad=0.0,
        info=landmark_information(5.0), source_id="liar",
    )
    pg.add_landmark_factor(liar)
    pg.add_switch(liar, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    pg.optimize()

    for f in honest:
        s = pg.switches()[pg._factor_key(f)]
        assert s > 0.7, f"honest switch={s:.3f}, want > 0.7"
