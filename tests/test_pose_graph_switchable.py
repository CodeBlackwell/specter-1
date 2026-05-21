"""Switchable Constraints substrate (SC_PLAN Wave 1) — switch storage,
state-vector extension, apply/revert round-trip.

Math-correctness tests (residual + Jacobian fork, analytic-vs-numeric)
land in Wave 2. This file gates the substrate: registration, slot
allocation, clamping, exact revert across boundary crossings."""

from __future__ import annotations

import numpy as np
import pytest

from specter.slam.pose_graph import (
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)


def _graph_with_two_landmark_factors() -> tuple[PoseGraph, LandmarkFactor, LandmarkFactor]:
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (5.0, 0.0))
    f_a = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="A",
    )
    f_b = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="B",
    )
    pg.add_landmark_factor(f_a)
    pg.add_landmark_factor(f_b)
    return pg, f_a, f_b


# ---------------------------------------------------------------------------
# Switch registration
# ---------------------------------------------------------------------------


def test_add_switch_initializes_switch_to_one():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    key = pg._factor_key(fa)  # noqa: SLF001 — accessing private for test gating
    assert pg.switches()[key] == 1.0


def test_add_switch_records_prior_strength():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=2.5)
    key = pg._factor_key(fa)
    assert pg.switch_priors()[key] == 2.5


def test_add_switch_rejects_unknown_factor():
    pg, _, _ = _graph_with_two_landmark_factors()
    foreign = LandmarkFactor(
        pose_id="p0", landmark_id="lm0",
        range_m=5.0, bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="not_registered",
    )
    with pytest.raises(ValueError, match="not registered"):
        pg.add_switch(foreign, prior_strength=1.0)


def test_add_switch_rejects_double_registration():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    with pytest.raises(ValueError, match="already has a switch"):
        pg.add_switch(fa, prior_strength=1.0)


def test_add_switch_rejects_nonpositive_prior():
    pg, fa, _ = _graph_with_two_landmark_factors()
    with pytest.raises(ValueError, match="positive"):
        pg.add_switch(fa, prior_strength=0.0)
    with pytest.raises(ValueError, match="positive"):
        pg.add_switch(fa, prior_strength=-1.0)


def test_switches_accessor_returns_copy():
    """External mutation of the returned dict does not affect optimizer state."""
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    snap = pg.switches()
    key = pg._factor_key(fa)
    snap[key] = 0.0
    assert pg.switches()[key] == 1.0, "switches() should return a copy"


# ---------------------------------------------------------------------------
# State-vector extension
# ---------------------------------------------------------------------------


def test_state_dim_grows_by_switch_count():
    pg, fa, fb = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))  # 1 free pose (p1; p0 is gauge)
    base_dim = pg._state_dim()  # 3 (p1) + 2 (lm0) = 5
    assert base_dim == 5
    pg.add_switch(fa, prior_strength=1.0)
    assert pg._state_dim() == base_dim + 1
    pg.add_switch(fb, prior_strength=1.0)
    assert pg._state_dim() == base_dim + 2


def test_switch_slot_ordering_is_insertion_deterministic():
    """Switch slots come after pose+landmark slots, in add_switch order."""
    pg, fa, fb = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fb, prior_strength=1.0)  # B first
    pg.add_switch(fa, prior_strength=1.0)
    base = pg._switch_tail_base()
    assert base == 3 + 2  # 1 free pose + 1 landmark
    assert pg._switch_slot(pg._factor_key(fb)) == base + 0
    assert pg._switch_slot(pg._factor_key(fa)) == base + 1


def test_switch_slot_raises_on_unregistered_key():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    with pytest.raises(KeyError, match="no switch"):
        pg._switch_slot("does/not/exist")


# ---------------------------------------------------------------------------
# Mode validation
# ---------------------------------------------------------------------------


def test_set_weight_mode_switchable_requires_at_least_one_switch():
    pg, _, _ = _graph_with_two_landmark_factors()
    with pytest.raises(ValueError, match="add_switch"):
        pg.set_weight_mode("switchable")


def test_set_weight_mode_switchable_accepts_with_one_switch():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    assert pg.weight_mode() == "switchable"


def test_set_weight_mode_rejects_unknown():
    pg, _, _ = _graph_with_two_landmark_factors()
    with pytest.raises(ValueError, match="unknown weight_mode"):
        pg.set_weight_mode("totally_invalid")


# ---------------------------------------------------------------------------
# Weight-of behavior in switchable mode
# ---------------------------------------------------------------------------


def test_weight_of_returns_s_squared_for_switchable_factor():
    pg, fa, fb = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    pg.add_switch(fb, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    key_a = pg._factor_key(fa)
    pg._switches[key_a] = 0.5
    # _weight_of returns s² (the effective info scaling per SC).
    assert pg._weight_of(fa) == pytest.approx(0.25)
    assert pg._weight_of(fb) == 1.0  # still at initial 1.0


def test_weight_of_returns_one_for_non_switchable_factor_in_switchable_mode():
    """Factors without a switch contribute as bare LM (weight=1) in SC mode."""
    pg, fa, fb = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)  # only A is switchable
    pg.set_weight_mode("switchable")
    assert pg._weight_of(fb) == 1.0


# ---------------------------------------------------------------------------
# Apply / revert round-trip with clamping (the load-bearing test for Wave 1)
# ---------------------------------------------------------------------------


def test_apply_step_updates_switch_additively():
    pg, fa, fb = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fa, prior_strength=1.0)
    pg.add_switch(fb, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    # delta = [0,0,0 for p1, 0,0 for lm0, -0.3 for fa, -0.1 for fb]
    delta = np.array([0, 0, 0, 0, 0, -0.3, -0.1])
    pg._apply_step(delta)
    assert pg.switches()[pg._factor_key(fa)] == pytest.approx(0.7)
    assert pg.switches()[pg._factor_key(fb)] == pytest.approx(0.9)


def test_apply_step_clamps_switch_below_zero():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fa, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    delta = np.array([0, 0, 0, 0, 0, -1.7])  # would push s to -0.7
    pg._apply_step(delta)
    assert pg.switches()[pg._factor_key(fa)] == 0.0


def test_apply_step_clamps_switch_above_one():
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fa, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    # Move s down then try to overshoot back up.
    pg._switches[pg._factor_key(fa)] = 0.4
    delta = np.array([0, 0, 0, 0, 0, 1.7])  # would push to 2.1
    pg._apply_step(delta)
    assert pg.switches()[pg._factor_key(fa)] == 1.0


def test_revert_step_restores_switch_exactly_after_boundary_clamp():
    """Naive -δ revert drifts when clamping fires; the pre-step snapshot must
    restore exactly. This is the load-bearing correctness gate for LM."""
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fa, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    key = pg._factor_key(fa)
    pg._switches[key] = 0.5
    pre_step = pg._switches[key]
    delta = np.array([0, 0, 0, 0, 0, -0.9])  # clamps to 0.0 (would be -0.4)
    pg._apply_step(delta)
    assert pg.switches()[key] == 0.0
    pg._revert_step(delta)
    assert pg.switches()[key] == pre_step, (
        f"revert drifted: pre={pre_step}, post={pg.switches()[key]}"
    )


def test_revert_step_restores_pose_and_landmark_alongside_switch():
    """Full revert round-trips poses, landmarks, AND switches together."""
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    pg.add_switch(fa, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    pg._switches[pg._factor_key(fa)] = 0.6
    p1_pre = pg._poses["p1"]
    lm_pre = pg._landmarks["lm0"]
    sw_pre = pg._switches[pg._factor_key(fa)]
    delta = np.array([0.1, -0.05, 0.02, 0.15, -0.08, -0.95])  # clamps switch
    pg._apply_step(delta)
    pg._revert_step(delta)
    assert pg._poses["p1"].x == pytest.approx(p1_pre.x, abs=1e-12)
    assert pg._poses["p1"].y == pytest.approx(p1_pre.y, abs=1e-12)
    assert pg._poses["p1"].theta == pytest.approx(p1_pre.theta, abs=1e-12)
    assert pg._landmarks["lm0"] == pytest.approx(lm_pre, abs=1e-12)
    assert pg._switches[pg._factor_key(fa)] == sw_pre


# ---------------------------------------------------------------------------
# Mode interactions — switch state is dormant outside switchable mode
# ---------------------------------------------------------------------------


def test_switch_state_dormant_in_non_switchable_modes():
    """Switches registered but mode = exogenous: weight_of returns the
    exogenous-prior weight, not s². The substrate must not leak into other
    modes."""
    pg, fa, _ = _graph_with_two_landmark_factors()
    pg.add_switch(fa, prior_strength=1.0)
    pg._switches[pg._factor_key(fa)] = 0.0  # would zero out in SC mode
    pg.set_weight_mode("exogenous")
    # Default rep = 1.0 (no reputation set), GNC weight = 1.0. Expect 1.0.
    assert pg._weight_of(fa) == 1.0
    pg.set_weight_mode("gnc")
    assert pg._weight_of(fa) == 1.0


def test_state_dim_does_not_include_switches_when_no_factors_registered():
    """A fresh graph with no add_switch calls has zero switch tail."""
    pg, _, _ = _graph_with_two_landmark_factors()
    pg.add_pose("p1", Pose2(1.0, 0.0, 0.0))
    assert pg._state_dim() == 3 + 2  # no switch tail
    assert pg._switch_tail_base() == 5
    assert pg.switches() == {}
