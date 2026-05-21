"""ADR 0022 — singleton-trusted-window lie defense.

A peer that lies in territory only it observes, then is caught lying
elsewhere and has its reputation collapsed externally, leaves a
singleton landmark in the pose graph with full information weight
(modulo the ADR 0018 reputation prior). The lie persists because:

1. There's no second reporter to disagree with → ADR 0020's residual
   χ² stays low → no β-evidence flows back to the trust evaluator.
2. ADR 0018's reputation prior gates the factor's weight by the
   liar's reputation, but a singleton observation with rep=0.01
   still encodes "this landmark is here, just less confidently" —
   downstream consumers reading the optimized map have no signal
   that the landmark is *uncorroborated* rather than merely *low-rep*.

ADR 0022 closes this with two composing mechanisms (singleton
confidence cap + stale-singleton fade) plus the provenance substrate
both need. These tests gate that composition.
"""

from __future__ import annotations

from specter.slam.pose_graph import (
    SINGLETON_INFO_SCALE,
    T_CORROBORATE,
    T_FADE,
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)


def _build_singleton_lie_graph(
    *, insertion_tick: int = 0
) -> tuple[PoseGraph, LandmarkFactor, LandmarkFactor]:
    """Construct the canonical ADR 0022 scenario:

    - One **shared** landmark (`lm_shared` at truth (5, 0)) observed by three
      honest peers AND the liar, all reporting range=5. Residual ≈ 0 for
      everyone here, so the liar's Beta evidence stays clean on this
      landmark (matches the "honest while building reputation" pattern).
    - One **singleton** landmark (`lm_singleton`, truth unknown to the swarm
      because only the liar ever observes it). Liar reports range=10 from
      pose (0, 0), bearing=π/2 → places it at (0, 10) in the optimized map.
      No honest peer ever sees this landmark.
    - The liar is *separately* caught lying elsewhere (modeled by collapsing
      their reputation directly — equivalent to a Tier 1 / Tier 2 ruling
      from ADR 0015 on a different attack surface).

    Returns the graph plus the singleton factor and one honest factor for
    weight comparison.
    """
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))

    # Shared landmark — four reporters, all consistent
    pg.add_landmark("lm_shared", (4.0, 0.0))
    honest_shared = None
    for i in range(3):
        f = LandmarkFactor(
            pose_id="p0",
            landmark_id="lm_shared",
            range_m=5.0,
            bearing_rad=0.0,
            info=landmark_information(5.0),
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(f, tick=insertion_tick)
        if honest_shared is None:
            honest_shared = f
    liar_shared = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm_shared",
        range_m=5.0,
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="liar",
    )
    pg.add_landmark_factor(liar_shared, tick=insertion_tick)

    # Singleton landmark — only the liar observes it, and they lie about it
    pg.add_landmark("lm_singleton", (0.0, 8.0))  # init close to lie
    singleton = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm_singleton",
        range_m=10.0,
        bearing_rad=1.5707963267948966,  # π/2
        info=landmark_information(10.0),
        source_id="liar",
    )
    pg.add_landmark_factor(singleton, tick=insertion_tick)

    assert honest_shared is not None
    return pg, singleton, honest_shared


def test_factor_provenance_recorded_at_insertion():
    """ADR 0022 §1: every landmark factor records (reporter_id,
    insertion_tick, reputation_at_insertion) when `tick=` is supplied to
    add_*_factor. Legacy callers omit the kwarg and get no provenance —
    preserves byte-exact parity for tests that haven't migrated."""
    pg = PoseGraph()
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm", (5.0, 0.0))
    pg.set_reputation_source(lambda _sid: 0.42)
    f = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm",
        range_m=5.0,
        bearing_rad=0.0,
        info=landmark_information(5.0),
        source_id="liar",
    )
    pg.add_landmark_factor(f, tick=10)
    prov = pg.factor_provenance(f)
    assert prov.insertion_tick == 10
    assert prov.reporter_id == "liar"
    assert prov.reputation_at_insertion == 0.42


def test_singleton_landmark_gets_confidence_cap():
    """ADR 0022 §2: a landmark with exactly one distinct reporter has its
    factor weight scaled by SINGLETON_INFO_SCALE (0.3) once the cap is
    enabled. Compared against a shared landmark — both observed by the
    same liar — only the singleton picks up the cap."""
    pg, singleton, honest_shared = _build_singleton_lie_graph()
    pg.enable_singleton_cap(True)
    pg.set_reputation_source(lambda _sid: 1.0)
    pg.optimize()

    w_singleton = pg._weight_of(singleton)
    w_shared = pg._weight_of(honest_shared)
    assert w_singleton <= SINGLETON_INFO_SCALE * 1.05, (
        f"singleton weight {w_singleton} should reflect cap {SINGLETON_INFO_SCALE}"
    )
    assert w_shared >= 0.9, f"shared weight {w_shared} should be ≈ 1.0 (no cap)"


def test_stale_singleton_fades_to_zero():
    """ADR 0022 §3: a singleton factor whose insertion_tick is more than
    T_CORROBORATE + T_FADE ticks behind current tick fades to zero info.
    Linear ramp: full cap until T_CORROBORATE; zero past T_CORROBORATE +
    T_FADE; linear in between."""
    pg, singleton, _ = _build_singleton_lie_graph(insertion_tick=0)
    pg.enable_singleton_cap(True)
    pg.enable_singleton_fade(True)
    pg.set_current_tick(T_CORROBORATE + T_FADE + 100)
    pg.set_reputation_source(lambda _sid: 1.0)
    pg.optimize()
    w = pg._weight_of(singleton)
    assert w < 1.0e-9, f"stale singleton weight {w} should fade to 0"


def test_singleton_fade_partial_ramp():
    """Linearity check at the half-fade point: at insertion + T_CORROBORATE
    + T_FADE/2, the fade multiplier is 0.5, so effective weight ≈
    0.5 · SINGLETON_INFO_SCALE."""
    pg, singleton, _ = _build_singleton_lie_graph(insertion_tick=0)
    pg.enable_singleton_cap(True)
    pg.enable_singleton_fade(True)
    pg.set_current_tick(T_CORROBORATE + T_FADE // 2)
    pg.set_reputation_source(lambda _sid: 1.0)
    pg.optimize()
    w = pg._weight_of(singleton)
    expected = 0.5 * SINGLETON_INFO_SCALE
    assert abs(w - expected) < 0.05, (
        f"half-fade weight {w} should be ≈ {expected}"
    )


def test_singleton_cap_composes_with_reputation_collapse():
    """End-to-end ADR 0022 failure mode:

    1. Liar builds reputation honestly (shared landmark, residual ≈ 0).
    2. Liar contributes a singleton-territory lie.
    3. Liar's reputation collapses externally (Tier 1/2 elsewhere).
    4. Singleton's effective weight reflects *both* mechanisms
       multiplicatively per ADR 0022 §5: Ω_eff ≈ 0.3 × 0.01 × Ω_base.

    Without the cap, rep alone leaves 0.01 × Ω_base — 30× more weight on
    an uncorroborated lie than the principled answer.
    """
    pg, singleton, _ = _build_singleton_lie_graph()
    pg.enable_singleton_cap(True)
    rep = {"liar": 0.01, "honest_0": 1.0, "honest_1": 1.0, "honest_2": 1.0}
    pg.set_reputation_source(lambda sid: rep.get(sid, 1.0))
    pg.optimize()

    w = pg._weight_of(singleton)
    expected_max = SINGLETON_INFO_SCALE * rep["liar"] * 1.1
    assert w <= expected_max, (
        f"singleton-from-collapsed-liar weight {w} should be ≤ {expected_max}; "
        f"without the cap it would be rep·Ω = {rep['liar']}"
    )


def test_cap_disabled_by_default_preserves_parity():
    """Backwards-compatibility guarantee: a graph that doesn't enable the
    cap behaves byte-exact like pre-ADR-0022 — singleton factors get the
    same `r · w_gnc` weight as before."""
    pg, singleton, _ = _build_singleton_lie_graph()
    pg.set_reputation_source(lambda _sid: 1.0)
    pg.optimize()
    assert pg._weight_of(singleton) >= 0.9, (
        "cap is opt-in; default behavior must match pre-ADR-0022 weight"
    )


def test_second_reporter_lifts_cap():
    """When a second reporter eventually adds a corroborating factor, the
    landmark is no longer singleton-sourced → cap and fade both drop."""
    pg, singleton, _ = _build_singleton_lie_graph(insertion_tick=0)
    pg.enable_singleton_cap(True)
    pg.set_reputation_source(lambda _sid: 1.0)
    pg.optimize()
    assert pg._weight_of(singleton) <= SINGLETON_INFO_SCALE * 1.05

    corroborator = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm_singleton",
        range_m=10.0,
        bearing_rad=1.5707963267948966,
        info=landmark_information(10.0),
        source_id="late_arriver",
    )
    pg.add_landmark_factor(corroborator, tick=100)
    pg.optimize()
    assert pg._weight_of(singleton) >= 0.9, (
        "second reporter should lift the singleton cap"
    )
