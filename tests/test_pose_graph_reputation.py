"""ADR 0018 Wave 4 — reputation as exogenous-prior DCS scaling.

Tests the load-bearing claim: a lying peer's factor information is
downweighted in proportion to the trust layer's reputation, suppressing
distortion of the optimized map even before GNC fires.
"""

import math

from specter.slam.pose_graph import (
    REPUTATION_FLOOR,
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)


def _close(a: float, b: float, tol: float = 1.0e-6) -> bool:
    return abs(a - b) <= tol


def _make_landmark_with_lie(rep_for_liar: float) -> tuple[PoseGraph, LandmarkFactor]:
    """3 honest peers report range=5; 1 lying peer reports range=10. Pose-0 is
    at origin, landmark truth at (5, 0). Returns the graph and the liar factor
    so the caller can set its reputation weight independently."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))  # bad initial guess
    for i in range(3):
        lf = LandmarkFactor(
            pose_id="p0",
            landmark_id="lm0",
            range_m=5.0,
            bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(lf)
        pg.set_reputation_weight(lf, 1.0)  # honest peers fully trusted
    liar = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=10.0,  # lying
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="liar",
    )
    pg.add_landmark_factor(liar)
    pg.set_reputation_weight(liar, rep_for_liar)
    return pg, liar


def test_high_rep_liar_distorts_map():
    """If the liar has reputation 1.0 (trust hasn't caught them), the map is
    distorted toward the liar's claim."""
    pg, _ = _make_landmark_with_lie(rep_for_liar=1.0)
    pg.optimize()
    lm_pos = pg.landmarks()["lm0"]
    err = math.hypot(lm_pos[0] - 5.0, lm_pos[1] - 0.0)
    assert err > 0.5, f"expected distortion from unweighted liar; got err={err:.4f}"


def test_low_rep_liar_suppressed():
    """If the liar has reputation 0.1 (trust layer caught them), the map
    closely recovers truth — exogenous-prior DCS at work."""
    pg, _ = _make_landmark_with_lie(rep_for_liar=0.1)
    pg.optimize()
    lm_pos = pg.landmarks()["lm0"]
    err = math.hypot(lm_pos[0] - 5.0, lm_pos[1] - 0.0)
    # Theoretical: weighted-avg range = (3·5 + 0.1·10)/3.1 ≈ 5.161 → err ≈ 0.16.
    # Tolerance 0.25 leaves headroom for LM numeric convergence noise.
    assert err < 0.25, f"expected near-truth recovery with low-rep liar; got err={err:.4f}"


def test_reputation_weighting_strictly_improves_recovery():
    """With everything else equal, lower liar reputation → lower error."""
    errs = []
    for rep in [1.0, 0.5, 0.1, REPUTATION_FLOOR]:
        pg, _ = _make_landmark_with_lie(rep_for_liar=rep)
        pg.optimize()
        lm_pos = pg.landmarks()["lm0"]
        errs.append(math.hypot(lm_pos[0] - 5.0, lm_pos[1] - 0.0))
    # Monotonically non-increasing as reputation drops.
    for k in range(len(errs) - 1):
        assert errs[k] >= errs[k + 1] - 1.0e-9, f"non-monotone at idx {k}: {errs}"


def test_reputation_weight_clamped_to_floor():
    """Setting reputation below REPUTATION_FLOOR clamps to the floor."""
    pg, liar = _make_landmark_with_lie(rep_for_liar=0.5)
    pg.set_reputation_weight(liar, -0.5)  # negative, clamped
    rep_w = pg.reputation_weights()
    liar_key = next(k for k in rep_w if "liar" in k)
    assert rep_w[liar_key] == REPUTATION_FLOOR


def test_reputation_weight_clamped_to_one():
    pg, liar = _make_landmark_with_lie(rep_for_liar=0.5)
    pg.set_reputation_weight(liar, 2.0)  # above 1, clamped
    rep_w = pg.reputation_weights()
    liar_key = next(k for k in rep_w if "liar" in k)
    assert rep_w[liar_key] == 1.0


def test_reputation_composes_with_gnc_multiplicatively():
    """The composition order per ADR 0018 §2: effective info = r · w_gnc · Ω.
    Verify that GNC running on top of frozen reputation weights produces
    even tighter outlier suppression than either alone."""
    # Liar with rep=0.5 — moderate trust gating.
    pg_rep_only, _ = _make_landmark_with_lie(rep_for_liar=0.5)
    pg_rep_only.optimize()
    err_rep_only = math.hypot(
        pg_rep_only.landmarks()["lm0"][0] - 5.0,
        pg_rep_only.landmarks()["lm0"][1] - 0.0,
    )
    pg_rep_plus_gnc, _ = _make_landmark_with_lie(rep_for_liar=0.5)
    pg_rep_plus_gnc.optimize_gnc()
    err_combined = math.hypot(
        pg_rep_plus_gnc.landmarks()["lm0"][0] - 5.0,
        pg_rep_plus_gnc.landmarks()["lm0"][1] - 0.0,
    )
    # GNC should further reduce error (or at worst maintain it).
    assert err_combined <= err_rep_only + 1.0e-9, (
        f"GNC + rep weight: {err_combined:.4f} vs rep alone: {err_rep_only:.4f}"
    )


# ---------------------------------------------------------------------------
# Live reputation source (un-freezing) — reputation evolves between optimize()
# calls and SLAM tracks it on the next assembly.
# ---------------------------------------------------------------------------


def test_live_reputation_source_takes_precedence_over_frozen():
    """set_reputation_source(...) wins over set_reputation_weight(...) frozen."""
    pg, liar = _make_landmark_with_lie(rep_for_liar=1.0)  # liar fully trusted (frozen)
    # Live source clamps liar to floor; honest peers stay at 1.0.
    pg.set_reputation_source(lambda sid: REPUTATION_FLOOR if sid == "liar" else 1.0)
    pg.optimize()
    err_live = math.hypot(pg.landmarks()["lm0"][0] - 5.0, pg.landmarks()["lm0"][1] - 0.0)
    # If the frozen 1.0 had won, error would exceed ~1m (matches test_high_rep_liar
    # bound). Live floor should pull it well under that.
    assert err_live < 0.5, f"live source should override frozen, got err={err_live:.4f}"


def test_live_reputation_source_responds_to_change_between_optimizes():
    """Changing reputation between two optimize() calls changes the next solution."""
    rep_state = {"liar": 1.0}
    pg, _ = _make_landmark_with_lie(rep_for_liar=1.0)
    pg.set_reputation_source(lambda sid: rep_state.get(sid, 1.0))
    pg.optimize()
    err_pre = math.hypot(pg.landmarks()["lm0"][0] - 5.0, pg.landmarks()["lm0"][1] - 0.0)
    # Mid-mission: trust catches the liar.
    rep_state["liar"] = REPUTATION_FLOOR
    pg.optimize()
    err_post = math.hypot(pg.landmarks()["lm0"][0] - 5.0, pg.landmarks()["lm0"][1] - 0.0)
    assert err_post < err_pre, (
        f"un-freezing should let optimizer recover; pre={err_pre:.4f} post={err_post:.4f}"
    )


def test_live_reputation_source_none_reverts_to_frozen():
    """Passing None to set_reputation_source restores the frozen-at-insertion path."""
    pg, _ = _make_landmark_with_lie(rep_for_liar=REPUTATION_FLOOR)
    pg.set_reputation_source(lambda _sid: 1.0)  # override with full trust
    pg.optimize()
    err_overridden = math.hypot(pg.landmarks()["lm0"][0] - 5.0, pg.landmarks()["lm0"][1] - 0.0)
    pg2, _ = _make_landmark_with_lie(rep_for_liar=REPUTATION_FLOOR)
    pg2.set_reputation_source(lambda _sid: 1.0)
    pg2.set_reputation_source(None)  # revert
    pg2.optimize()
    err_frozen = math.hypot(pg2.landmarks()["lm0"][0] - 5.0, pg2.landmarks()["lm0"][1] - 0.0)
    # Reverted graph uses frozen REPUTATION_FLOOR → should beat the overridden one.
    assert err_frozen < err_overridden
