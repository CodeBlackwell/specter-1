"""ADR 0022 §4 — reputation-tracking switch prior strength.

When `weight_mode = "switchable"` and the rep-tracking flag is on, the
per-factor switch prior γ_i becomes a function of the reporter's current
reputation. The math sits inside the existing SC linearization
(`_accumulate_sc_switch_terms`): only the γ term changes, the rest of
the Hessian/gradient assembly is unchanged.

Direction (corrected from the ADR's first draft): SC's prior `√γ·(1−s)`
pulls s → 1, so optimal s* = γ/(‖r‖² + γ). **Low γ → switch free to
drop under residual evidence; high γ → switch pinned at 1.** Therefore:
- High-rep peer → γ high → switch anchored (trust the report).
- Low-rep peer → γ → γ_floor → switch released; residual decides.

Test discipline:
1. Static behavior: with the flag *off*, SC math is byte-exact unchanged
   (gated by the broader switchable suite still passing).
2. Dynamic behavior: with the flag on, a low-rep liar's switch drops
   *lower* than the fixed-γ baseline because the strong static prior
   would have anchored it artificially high.
"""

from __future__ import annotations

from specter.slam.pose_graph import (
    GAMMA_FLOOR,
    GAMMA_REP_SCALE,
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)


def _build_sc_lying_landmark_graph(reporter: str = "liar") -> tuple[PoseGraph, LandmarkFactor]:
    """3 honest + 1 lying observer of `lm0` (truth at (5, 0); liar reports
    range 10). All four factors registered as switchable with γ_base = 1.0."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))
    for i in range(3):
        f = LandmarkFactor(
            pose_id="p0", landmark_id="lm0",
            range_m=5.0, bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(f)
        pg.add_switch(f, prior_strength=1.0)
    liar = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=10.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id=reporter,
    )
    pg.add_landmark_factor(liar)
    pg.add_switch(liar, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    return pg, liar


def test_effective_gamma_falls_back_to_static_when_flag_disabled():
    """ADR 0022 §4 default-off contract: _effective_gamma returns the
    static value from add_switch when reputation-tracking is disabled,
    even if a reputation source is set."""
    pg, liar = _build_sc_lying_landmark_graph()
    pg.set_reputation_source(lambda _sid: 0.01)
    key = pg._factor_key(liar)
    assert pg._effective_gamma(key) == 1.0


def test_effective_gamma_scales_with_reputation():
    """ADR 0022 §4 formula: γ_eff = γ_base · r · 10 + 0.01.
    At rep=1.0 → γ_eff ≈ 10.01 (strong anchor at s=1).
    At rep=0.5 → γ_eff = 5.01.
    At rep=0.01 (floor) → γ_eff ≈ 0.11 → effectively released."""
    pg, liar = _build_sc_lying_landmark_graph()
    pg.enable_reputation_tracking_gamma(True)
    key = pg._factor_key(liar)
    rep = {"liar": 1.0}
    pg.set_reputation_source(lambda sid: rep[sid])
    expected = 1.0 * 1.0 * GAMMA_REP_SCALE + GAMMA_FLOOR
    assert abs(pg._effective_gamma(key) - expected) < 1.0e-9

    rep["liar"] = 0.5
    expected = 1.0 * 0.5 * GAMMA_REP_SCALE + GAMMA_FLOOR
    assert abs(pg._effective_gamma(key) - expected) < 1.0e-9

    rep["liar"] = 0.01
    expected = 1.0 * 0.01 * GAMMA_REP_SCALE + GAMMA_FLOOR
    assert abs(pg._effective_gamma(key) - expected) < 1.0e-9


def test_rep_collapse_drives_switch_lower_than_fixed_gamma():
    """Head-to-head: same lying scenario, with vs without rep-tracking γ.

    With static γ_base=1.0, the prior is moderately strong and partially
    anchors the liar's switch. With rep-tracking ON and the liar at
    rep=floor, γ_eff ≈ 0.11 — prior is essentially off, so the residual
    evidence (||r||² is large because the liar reports range=10 vs truth
    ~5) drives s* = γ/(||r||² + γ) ≈ 0.

    The rep-tracking variant must converge the liar's switch strictly
    lower than the fixed-γ baseline."""
    rep = {"honest_0": 1.0, "honest_1": 1.0, "honest_2": 1.0, "liar": 0.01}

    pg_fixed, liar_fixed = _build_sc_lying_landmark_graph()
    pg_fixed.set_reputation_source(lambda sid: rep[sid])
    pg_fixed.optimize()
    s_fixed = pg_fixed.switches()[pg_fixed._factor_key(liar_fixed)]

    pg_track, liar_track = _build_sc_lying_landmark_graph()
    pg_track.set_reputation_source(lambda sid: rep[sid])
    pg_track.enable_reputation_tracking_gamma(True)
    pg_track.optimize()
    s_track = pg_track.switches()[pg_track._factor_key(liar_track)]

    assert s_track <= s_fixed + 1.0e-9, (
        f"rep-tracking γ should release the prior on a low-rep liar, "
        f"so the switch drops at least as far as fixed-γ: "
        f"fixed={s_fixed:.4f}, tracking={s_track:.4f}"
    )
    # And it should be effectively zero given that the prior is released
    assert s_track < 0.05, f"released-prior switch should be ≈ 0, got {s_track:.4f}"


def test_high_rep_under_tracking_keeps_switch_near_one():
    """Honest peers with rep ≈ 1.0 get γ_eff ≈ 10 — the strong anchor.
    Their residual is near zero so the prior wins easily and s → 1."""
    pg, _ = _build_sc_lying_landmark_graph()
    rep = {"honest_0": 1.0, "honest_1": 1.0, "honest_2": 1.0, "liar": 1.0}
    pg.set_reputation_source(lambda sid: rep[sid])
    pg.enable_reputation_tracking_gamma(True)
    pg.optimize()
    for i in range(3):
        s = pg.switches()[
            pg._factor_key(
                next(f for f in pg._landmark_factors if f.source_id == f"honest_{i}")
            )
        ]
        assert s > 0.9, f"honest_{i} switch under tracking γ should ≈ 1, got {s:.4f}"


def test_source_id_of_key_parses_landmark_and_odometry_keys():
    """ADR 0022 §4 helper: _source_id_of_key parses out the reporter id
    from both `lm/.../src` and `odom/.../src` factor keys."""
    assert PoseGraph._source_id_of_key("lm/p0/lm0/liar") == "liar"
    assert PoseGraph._source_id_of_key("odom/p0/p1/honest_2") == "honest_2"
