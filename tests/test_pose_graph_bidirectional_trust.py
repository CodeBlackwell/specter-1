"""ADR 0019 — bidirectional trust↔SLAM coupling.

Tests that SLAM factor residuals feed back into the BetaTrustEvaluator as
evidence, closing the loop ADR 0018 documented as "future experimentation".

Three layers:
1. `slam_residual_evidence` shape: inlier → +alpha, outlier → +beta, skips
   work as documented.
2. End-to-end with BetaTrustEvaluator: a lying landmark observer's rep
   collapses below honest observers' after one optimize → evidence → observe
   cycle.
3. Stability: feeding the live evaluator back into PoseGraph via
   `set_reputation_source` (closing the full loop) converges to a stable
   weighting under repeated cycles (ADR 0019 §5 mitigation).
"""

from __future__ import annotations

import math

from specter.slam.pose_graph import (
    SLAM_CHISQ_INLIER,
    SLAM_CHISQ_OUTLIER,
    LandmarkFactor,
    OdometryFactor,
    Pose2,
    PoseGraph,
    landmark_information,
    odometry_information,
)
from specter.trust.evaluator import BetaTrustEvaluator


def _build_all_honest_graph() -> PoseGraph:
    """3 honest observers, all reporting range=5 to the same landmark. After
    optimize, every factor's residual is ~0 → all classify as inliers."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))  # bad initial guess; optimizer pulls to 5
    for i in range(3):
        pg.add_landmark_factor(LandmarkFactor(
            pose_id="p0",
            landmark_id="lm0",
            range_m=5.0,
            bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        ))
    return pg


def _build_landmark_graph_with_one_liar() -> PoseGraph:
    """3 honest observers + 1 lying observer of the same landmark. Pose-0 at
    origin, landmark truth at (5, 0). Liar reports range=10 instead of 5.

    Note: at equal weight, the optimum sits at r̂ = (3·5 + 10)/4 = 6.25, so
    honest factors also have nonzero residual. The end-to-end tests apply
    reputation gating (via the closed loop) so honest factors converge after
    a few cycles. For pure inlier classification, use _build_all_honest_graph."""
    pg = _build_all_honest_graph()
    pg.add_landmark_factor(LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=10.0,  # lie
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="liar",
    ))
    return pg


def test_slam_evidence_classifies_inlier_as_alpha():
    """Honest factor residual χ² ≤ INLIER_TAU → +alpha for that source.
    All-honest graph: optimum perfectly fits all reports → χ² ≈ 0 for each."""
    pg = _build_all_honest_graph()
    pg.optimize()
    ev = pg.slam_residual_evidence()
    for i in range(3):
        assert ev.get(f"honest_{i}", {}).get("alpha", 0.0) > 0.0, (
            f"honest_{i} should have positive alpha: {ev}"
        )


def test_slam_evidence_classifies_outlier_as_beta():
    """Liar factor residual χ² ≥ OUTLIER_TAU → +beta for that source."""
    pg = _build_landmark_graph_with_one_liar()
    pg.optimize()
    ev = pg.slam_residual_evidence()
    assert ev.get("liar", {}).get("beta", 0.0) > 0.0, (
        f"liar should have positive beta: {ev}"
    )
    assert ev.get("liar", {}).get("alpha", 0.0) == 0.0, (
        f"liar should not have positive alpha: {ev}"
    )


def test_slam_evidence_skips_odometry_self_source():
    """Odometry factors aren't included — they're self-source so emitting
    evidence would be self-incrimination."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_odometry_factor(OdometryFactor(
        from_id="p0",
        to_id="p1",
        measurement=Pose2(1.0, 0.0, 0.0),
        info=odometry_information(0.1),
        source_id="self_agent",  # would be self-source in real usage
    ))
    pg.optimize()
    ev = pg.slam_residual_evidence()
    # Odometry factors aren't walked by slam_residual_evidence; should be empty.
    assert "self_agent" not in ev, f"odometry source should be skipped: {ev}"


def test_slam_evidence_skips_loop_closure_source():
    """Loop closure factors have source_id == 'loop_closure' — not a peer."""
    pg = _build_landmark_graph_with_one_liar()
    # The loop_closure source_id is hardcoded in LoopClosureFactor; even if
    # we manually inject a LandmarkFactor with that source_id, it must skip.
    pg.add_landmark_factor(LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=10.0,
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="loop_closure",
    ))
    pg.optimize()
    ev = pg.slam_residual_evidence()
    assert "loop_closure" not in ev, f"loop_closure source should be skipped: {ev}"


def test_slam_evidence_skips_self_id():
    """Factors whose source_id matches the self_id arg are skipped."""
    pg = _build_landmark_graph_with_one_liar()
    pg.optimize()
    ev = pg.slam_residual_evidence(self_id="honest_0")
    assert "honest_0" not in ev, f"self_id should be skipped: {ev}"
    assert "honest_1" in ev or "honest_2" in ev, (
        f"other honest peers should still be present: {ev}"
    )


def test_end_to_end_bidirectional_loop_collapses_liar_rep():
    """ADR 0019 acceptance: liar's rep drops below honest peers' after one
    optimize_gnc → emit → observe cycle. GNC pre-classifies outliers so the
    geometric residuals at convergence cleanly separate honest from lying.
    This is the closed loop in action."""
    pg = _build_landmark_graph_with_one_liar()
    evaluator = BetaTrustEvaluator()
    pg.optimize_gnc()  # GNC down-weights the lie; honest factors → χ² ≈ 0
    for source, evidence in pg.slam_residual_evidence().items():
        evaluator.observe(source, evidence)
    rep_liar = evaluator.reputation("liar")
    rep_honest = [evaluator.reputation(f"honest_{i}") for i in range(3)]
    assert rep_liar < min(rep_honest), (
        f"liar rep ({rep_liar:.3f}) should be < min honest rep ({min(rep_honest):.3f})"
    )


def test_full_closed_loop_stable_under_repeated_cycles():
    """ADR 0019 §5 stability mitigation: when set_reputation_source wires
    the live evaluator back into PoseGraph (full closed loop), repeated
    optimize → emit → observe cycles converge to a stable weighting rather
    than oscillating. Liar's rep monotonically declines; honest peers stay up."""
    pg = _build_landmark_graph_with_one_liar()
    evaluator = BetaTrustEvaluator()
    pg.set_reputation_source(evaluator.reputation)  # close the loop

    rep_liar_history = []
    rep_honest_history = []
    for _ in range(5):
        pg.optimize_gnc()
        for source, evidence in pg.slam_residual_evidence().items():
            evaluator.observe(source, evidence)
        rep_liar_history.append(evaluator.reputation("liar"))
        rep_honest_history.append(evaluator.reputation("honest_0"))

    # Liar monotonically declines (allowing tiny noise on the last cycles where
    # both contributions are near asymptote).
    for i in range(1, len(rep_liar_history)):
        assert rep_liar_history[i] <= rep_liar_history[i - 1] + 1.0e-6, (
            f"liar rep not monotonic: {rep_liar_history}"
        )
    # Honest rep stays well above 0.5 (the uninformed prior).
    for r in rep_honest_history:
        assert r > 0.5, f"honest rep collapsed: {rep_honest_history}"
    # Asymptote: liar rep < honest rep by a clear margin.
    assert rep_liar_history[-1] < rep_honest_history[-1] - 0.1


def test_chisq_thresholds_bracket_standard_table():
    """SLAM_CHISQ_INLIER = 1.386 ≈ F⁻¹(0.50, df=2); OUTLIER = 5.991 ≈ F⁻¹(0.95, df=2)."""
    # Standard chi-square inverse-CDF values for 2 degrees of freedom.
    assert abs(SLAM_CHISQ_INLIER - 1.386) < 1.0e-3
    assert abs(SLAM_CHISQ_OUTLIER - 5.991) < 1.0e-3
    assert SLAM_CHISQ_INLIER < SLAM_CHISQ_OUTLIER


def test_slam_evidence_returns_empty_for_borderline_residuals():
    """Residuals between the two thresholds emit no evidence (keeps the
    evaluator quiet on uninformative measurements)."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (5.0, 0.0))
    # σ_r for landmark at range 5 is sigma_beacon · (1 + 5/10) = 0.15.
    # χ² ≈ (1.5 σ)² / σ² = 2.25 lies between 1.386 and 5.991.
    pg.add_landmark_factor(LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=5.0 + 1.5 * 0.15,  # 1.5σ off-truth
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="borderline",
    ))
    # Don't optimize — residual is already at the chosen offset.
    ev = pg.slam_residual_evidence()
    # χ² ≈ 2.25 ∈ (INLIER, OUTLIER) → no evidence emitted.
    assert "borderline" not in ev or (
        ev["borderline"]["alpha"] == 0.0 and ev["borderline"]["beta"] == 0.0
    ), f"borderline residual emitted evidence: {ev}"


def test_per_source_evidence_accumulates_across_multiple_factors():
    """When the same source emits multiple factors, evidence accumulates.
    All-honest graph so all factors classify as inliers cleanly."""
    pg = _build_all_honest_graph()
    pg.add_landmark_factor(LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=5.0,
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="honest_0",
    ))
    pg.optimize()
    ev = pg.slam_residual_evidence()
    h0_alpha = ev.get("honest_0", {}).get("alpha", 0.0)
    h1_alpha = ev.get("honest_1", {}).get("alpha", 0.0)
    assert h0_alpha > h1_alpha, (
        f"honest_0 alpha ({h0_alpha}) should exceed single-factor honest_1 ({h1_alpha})"
    )


# Avoid unused-import warning while keeping the helper available for callers
# that want to use the math module in extended versions of these tests.
_ = math.pi
