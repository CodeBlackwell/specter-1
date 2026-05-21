"""Red-team attack battery. Each test runs a scripted scenario through
`run_scenario` and asserts on the resulting metrics. Catches regressions
in trust-engine behavior across realistic adversary patterns.
"""

import pytest

from . import scenarios
from .runner import EvaluationResult, run_scenario

NEUTRAL = 0.5
HEALED = 0.85
RANK_GAP = 0.2  # honest peers must outrank attackers by at least this much


def _honest_views_of(result: EvaluationResult, peer: str) -> list[float]:
    attackers = set(result.scenario.attackers)
    return [r[peer] for v, r in result.final_rep.items() if v not in attackers and v != peer]


def _min_honest_view(result: EvaluationResult, agent_ids: list[str]) -> float:
    return min(min(_honest_views_of(result, a)) for a in agent_ids)


def test_honest_swarm_has_no_false_positives_and_full_trust():
    result = run_scenario(scenarios.honest_swarm())
    assert all(t is None for t in result.false_positive_ticks.values())
    for peer in ["alpha", "bravo", "charlie", "delta"]:
        for view in _honest_views_of(result, peer):
            assert view >= 0.9, f"honest peer {peer} ranked {view:.2f}"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "ADR 0015: pose_lie alone is a trust-layer no-op under range-only "
        "voting (subject self-pose exits the trust path). Wave 2 replaces "
        "this scenario with a range_lie equivalent that does assert "
        "detection. The pose_lie audit surface migrates to map-merger "
        "fragment anomalies in a follow-on slice."
    ),
)
def test_single_pose_liar_is_detected_and_outranked():
    result = run_scenario(scenarios.single_pose_liar())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 5
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor, (
        f"liar reps {liar_views} not clearly below honest floor {honest_floor:.2f}"
    )
    assert all(t is None for t in result.false_positive_ticks.values())


def test_single_bad_key_collapses_immediately():
    result = run_scenario(scenarios.single_bad_key())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 5
    for view in _honest_views_of(result, "alpha"):
        assert view < 0.05, f"bad-key peer not zeroed: {view:.2f}"
    assert all(t is None for t in result.false_positive_ticks.values())


@pytest.mark.xfail(
    strict=True,
    reason="ADR 0015: pose_lie reclassified — Wave 2 replaces with colluder_pair range attack.",
)
def test_colluding_pair_pose_liars_outranked_by_honest_majority():
    """With cohort-close voting, the honest majority (4 of 6) carries the
    median against the 2-of-6 cabal. Honest peers reach unanimous trust;
    colluders are clearly outranked AND detected."""
    result = run_scenario(scenarios.colluding_pair_pose_liars())
    honest_ids = ["charlie", "delta", "echo", "foxtrot"]
    for liar in ["alpha", "bravo"]:
        assert result.detection_ticks[liar] is not None
        assert result.detection_ticks[liar] <= 5
        liar_views = _honest_views_of(result, liar)
        honest_floor = _min_honest_view(result, honest_ids)
        assert max(liar_views) + RANK_GAP < honest_floor, (
            f"colluder {liar} not below honest floor: {liar_views} vs {honest_floor:.2f}"
        )
    assert all(t is None for t in result.false_positive_ticks.values())


@pytest.mark.xfail(
    strict=True,
    reason="ADR 0015: pose_lie reclassified — Wave 2 adds delayed range_lie scenario.",
)
def test_sleeper_pose_liar_drops_below_peers_after_wake():
    result = run_scenario(scenarios.sleeper_pose_liar())
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor, (
        f"sleeper not penalized after wake: liar {liar_views} vs honest {honest_floor:.2f}"
    )


def test_liar_recovers_after_healing_via_decay():
    """ADR 0015 Wave 2: liar_then_heals now exercises a real range_lie + heal
    cycle (was pose_lie no-op pre-Wave 2). Asserts the recovery property —
    reputation climbs back toward the prior after the attacker heals, as
    Beta evidence decays with the 10s half-life. Matches rail Lesson 02
    (`recovery_after_lie`): same 20-tick lie window (t=30..50), same
    recovery mechanism, two surfaces.

    Note: the lie window is intentionally short enough that rep dips
    visibly without crossing the 0.4 detection threshold (accrued α from
    t=0..30 honest history insulates against brief perturbation). The
    notebook 08 trajectory shows the dip; this test asserts only the
    bound-checkable recovery property.
    """
    result = run_scenario(scenarios.liar_then_heals())
    healed_views = _honest_views_of(result, "alpha")
    assert min(healed_views) > HEALED, (
        f"healed peer didn't recover toward the prior: {healed_views}"
    )
    assert all(t is None for t in result.false_positive_ticks.values())


def test_replay_storm_collapses_attacker_fast():
    """Repeated replays accumulate β via the bus's replay window. Detection
    crosses the threshold within a handful of ticks."""
    result = run_scenario(scenarios.replay_storm())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 5
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


def test_sensor_fuzz_attacker_detected():
    """A fuzzer's observations are outliers in voting; rep collapses."""
    result = run_scenario(scenarios.sensor_fuzz())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 10
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


@pytest.mark.xfail(
    strict=True,
    reason="ADR 0015: drift_pose is pose-side only — Wave 2 adds gradient range-drift scenario.",
)
def test_gradient_drift_attacker_detected_once_threshold_crossed():
    """Slowly drifting self-pose crosses the geometric threshold; once over,
    each tick adds β as both subject and observer outlier. With low
    accept_alpha, drift detection consistently fires within a few half-lives."""
    result = run_scenario(scenarios.gradient_drift())
    assert result.detection_ticks["alpha"] is not None
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


@pytest.mark.xfail(
    reason=(
        "Calibrated for the pre-V3 fixed-0.5m cohort threshold. Under "
        "per-observation uncertainty propagation (k·σ at ~1m peer spacing → "
        "~1.1m threshold), a 2.0 rad/s gyro bias produces cross-range error "
        "around 0.9–1.0m — inside the noise envelope. Honest votes about the "
        "attacker's correct xy keep pumping α, so net rep settles ~0.5 rather "
        "than crossing 0.4. The ranking is still correct (attacker well below "
        "honest peers); the absolute-threshold detection is what regresses. "
        "Tracking a follow-up: either widen peer spacing in a new scenario or "
        "introduce a separate position-trust subscore that doesn't blend with "
        "subject-side α."
    ),
    strict=True,
)
def test_odometry_corrupt_attacker_detected_via_geometric_voting():
    """SLAM-native attack: corrupted IMU drifts attacker's theta. The
    attacker's pose-report stays correct (held-velocity SLAM tracks xy), so
    α from correct-subject voting keeps flowing; only the attacker's *outgoing
    observations* are wrong (rotated by Δθ around itself). Pre-V3 detection
    crossed the 0.4 threshold around tick 50; under uncertainty propagation
    the cross-range signal at 1m peer spacing sits inside the noise envelope."""
    result = run_scenario(scenarios.odometry_corrupt())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 60
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


def test_beacon_spoof_attacker_detected():
    """SLAM-native: attacker adds +SPOOF_OFFSET to all beacon ranges. Other
    observers' beacons disagree → spoofer blamed as outlier observer."""
    result = run_scenario(scenarios.beacon_spoof())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 5
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


def test_range_lie_attacker_detected_via_tier1():
    """ADR 0015 Wave 2 attack. range_lie inflates outgoing range_m; reciprocal
    disagreement with honest peers' beacons crosses k·σ within 1–3 ticks."""
    result = run_scenario(scenarios.range_lie())
    assert result.detection_ticks["alpha"] is not None
    assert result.detection_ticks["alpha"] <= 5
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


def test_forged_envelope_rejected_at_wire_boundary():
    """External adversary (not in roster) emits observation envelopes every
    tick. Each fails ECDSA signature verification at `open_envelope` because
    the roster has no public key for the sender; the bus handler raises
    VerificationError and `record_reject` is called — the trust evaluator
    never sees the payload. Real agents' reputations stay near the uniform
    prior. Pairs with rail Lesson 01 (`forged_envelope`)."""
    result = run_scenario(scenarios.forged_envelope())
    # No detection ticks because no attackers (x0 is foreign, not in
    # scenario.attackers).
    assert result.detection_ticks == {}
    # No false positives — wire-layer rejection doesn't perturb honest reps.
    assert all(t is None for t in result.false_positive_ticks.values())
    # Every real-agent → real-agent reputation stayed essentially at the
    # honest baseline (no rejected envelope reached the cohort math).
    for viewer, peers in result.final_rep.items():
        for peer, rep in peers.items():
            if viewer == peer:
                continue
            assert rep > 0.9, (
                f"forged-envelope rejection should not perturb honest reps; "
                f"got {viewer}->{peer}={rep:.3f}"
            )
    # x0 never registered as a known peer because its envelope was rejected
    # at the wire boundary, well before any per-peer cohort accrual.
    assert "x0" not in result.final_rep.get("alpha", {})


def test_cop_phantom_suppressed_once_reporter_collapses():
    """ADR 0019: trust-weighted COP filter drops phantoms reported only by
    a low-reputation peer. Alpha plants `phantom-uxo-1` while lying on
    inter-drone range; Tier 1 reciprocal disagreement collapses alpha's
    reputation; the phantom (which only alpha ever reports) falls below
    `COP_TRUST_THRESHOLD = 0.5` and is dropped from the COP. Real
    `uxo-bravo` (visible to all honest peers within sensor radius) stays
    surfaced. Pairs with rail Lesson 08 component `cop_phantom`."""
    result = run_scenario(scenarios.cop_phantom())
    # Phantom dropped.
    assert "phantom-uxo-1" not in result.cop, (
        f"phantom should be filtered once alpha's rep collapses; "
        f"got {result.cop.get('phantom-uxo-1')}"
    )
    # Real UXO surfaces.
    assert "uxo-bravo" in result.cop, "real uxo-bravo should still be surfaced"
    # Attacker rep collapsed (precondition for COP filter to fire).
    honest_views = _honest_views_of(result, "alpha")
    assert max(honest_views) < 0.4


def test_cop_suppress_real_item_survives_via_redundancy():
    """ADR 0019: blackout attack fails as long as ≥ 1 honest peer reports
    the item. Alpha hides `uxo-bravo` from its contact stream; bravo,
    charlie, delta still report it; the COP aggregates honest reports
    and keeps the entry. The attacker's range_lie still collapses its
    own reputation independently. Pairs with rail Lesson 08 component
    `cop_suppress`."""
    result = run_scenario(scenarios.cop_suppress())
    assert "uxo-bravo" in result.cop, "honest peers should surface uxo-bravo via redundancy"
    surviving = result.cop["uxo-bravo"]
    assert "alpha" not in surviving.reporters, (
        f"attacker should NOT appear in reporter list (blackout); "
        f"got {surviving.reporters}"
    )
    assert set(surviving.reporters) == {"bravo", "charlie", "delta"}
    assert surviving.weight > 0.85, (
        f"honest peers' average rep should keep entry well above threshold; "
        f"got weight={surviving.weight:.3f}"
    )
    honest_views = _honest_views_of(result, "alpha")
    assert max(honest_views) < 0.4


def test_cop_fob_corrupt_anchor_protected():
    """ADR 0019: spatial-anchor corruption defeated by the same defense.
    Alpha hides the friendly FOB STALWART and broadcasts a phantom hostile
    FOB; once Tier 1 collapses alpha, the COP drops the phantom and the
    real FOB stays surfaced via honest reporters. Pairs with rail Lesson 08
    component `cop_fob_corrupt`."""
    result = run_scenario(scenarios.cop_fob_corrupt())
    assert "phantom-fob-1" not in result.cop, "phantom hostile FOB should be filtered"
    assert "fob-stalwart" in result.cop, "real FOB should still be surfaced"
    surviving = result.cop["fob-stalwart"]
    assert "alpha" not in surviving.reporters
    assert surviving.weight > 0.85
    honest_views = _honest_views_of(result, "alpha")
    assert max(honest_views) < 0.4


def test_cop_corruption_full_composite_defeated():
    """ADR 0019: composite map-layer attack — phantom UXO + phantom hostile
    FOB + suppress real UXO-β + suppress real FOB STALWART — all defeated
    by one trust-weighted COP filter. Mirrors the TS rail's
    `cop_corruption_full` for L08."""
    result = run_scenario(scenarios.cop_corruption_full())
    # Both phantoms dropped.
    assert "phantom-uxo-1" not in result.cop
    assert "phantom-fob-1" not in result.cop
    # Both real items survive via honest peers.
    assert "uxo-bravo" in result.cop
    assert "fob-stalwart" in result.cop
    for cid in ("uxo-bravo", "fob-stalwart"):
        entry = result.cop[cid]
        assert "alpha" not in entry.reporters
        assert entry.weight > 0.85, f"{cid} weight {entry.weight:.3f} below 0.85"
    honest_views = _honest_views_of(result, "alpha")
    assert max(honest_views) < 0.4


def test_partition_gossip_asymmetric_detection():
    """Network partition + gossip-bridged reconciliation. Alpha (clique A,
    with bravo) lies; charlie and delta are in clique B with cross-clique
    observations dropped per `link_predicate`. Reputation gossip continues
    across cliques (eventually-consistent per ADR 0015) but is weighted by
    `GOSSIP_DISCOUNT = 0.1`, so cross-clique reputation perturbation is
    bounded.

    Measured (n_ticks=300, threshold=0.4): bravo (same clique, direct
    observation) drops alpha to ~0.37; charlie/delta (cross-clique,
    gossip only) settle at ~0.73. Pedagogically the partition exposes
    the *limit* of gossip-only reconciliation — direct observation
    drives strong detection; gossip-discount alone is not enough to
    cross threshold from a uniform prior. Pairs with rail Lesson 06.
    """
    result = run_scenario(scenarios.partition_gossip())
    bravo_view = result.final_rep["bravo"]["alpha"]
    cross_clique_views = [
        result.final_rep["charlie"]["alpha"],
        result.final_rep["delta"]["alpha"],
    ]
    # Same-clique peer catches the lie directly.
    assert bravo_view < 0.4, (
        f"same-clique honest peer should detect alpha via direct Tier 1; "
        f"got bravo→alpha={bravo_view:.3f}"
    )
    # Cross-clique peers receive only gossip; discount-bounded perturbation
    # below the uniform prior (0.5) but above the detection threshold.
    for view in cross_clique_views:
        assert 0.5 < view < 0.85, (
            f"cross-clique peer should see gossip-discounted perturbation "
            f"(between prior 0.5 and undisturbed 0.85), got {view:.3f}"
        )
    # The asymmetry is the lesson: direct observation drives detection,
    # gossip alone does not.
    min_cross = min(cross_clique_views)
    assert min_cross - bravo_view > 0.25, (
        f"expected meaningful partition-induced gap; bravo {bravo_view:.3f} "
        f"vs cross-clique min {min_cross:.3f}"
    )
    assert all(t is None for t in result.false_positive_ticks.values())


def test_late_range_lie_detected_after_wake():
    """Mid-mission Byzantine flip on the range layer. Attacker flies honestly
    through `wake_tick=60`, then begins inflating outgoing `range_m`. Detection
    eventually fires, but latency scales with accrued honest history — high α
    at wake means β has to overcome a deeper prior. This is a measured property
    of Beta forgiveness, not a bug. Pairs with rail Lesson 05.

    Measured bound: with wake_tick=60 and n_ticks=500, detection fires by
    ~tick 413 (latency ~353 from wake). Asserted with a 100-tick margin."""
    WAKE = 60
    LATENCY_BUDGET = 450  # measured ~353; margin for noise
    result = run_scenario(scenarios.late_range_lie(wake_tick=WAKE))
    detection_tick = result.detection_ticks["alpha"]
    assert detection_tick is not None, (
        "late_range_lie undetected within 500 ticks — accrued α should still "
        "erode under steady β accumulation"
    )
    assert detection_tick >= WAKE, (
        f"late_range_lie fired before wake_tick={WAKE}: {detection_tick}"
    )
    latency = detection_tick - WAKE
    assert latency <= LATENCY_BUDGET, (
        f"late_range_lie detection latency {latency} ticks exceeds budget "
        f"{LATENCY_BUDGET} — accrued α may be insulating more than expected"
    )
    # The interesting finding: latency is *significantly* larger than the
    # standard range_lie's 5-tick bound. Document by asserting the gap.
    assert latency > 5, (
        f"late_range_lie latency {latency} matches range_lie's 5-tick bound — "
        f"expected slower detection due to accrued honest history"
    )
    liar_views = _honest_views_of(result, "alpha")
    honest_floor = _min_honest_view(result, ["bravo", "charlie", "delta"])
    assert max(liar_views) + RANK_GAP < honest_floor
    assert all(t is None for t in result.false_positive_ticks.values())


def test_colluder_pair_caught_by_tier2_mds():
    """ADR 0015 Wave 2 attack. Two colluders symmetrically inflate their
    mutual A↔B range. Tier 1 reciprocal misses (symmetric lie); Tier 2 MDS
    edge-residual analysis against honest peers' geometry catches the
    non-embeddability and charges β to both colluders across cohorts.
    Uses six_corners (N=6) where multilateration redundancy is sufficient."""
    result = run_scenario(scenarios.colluder_pair())
    honest_ids = ["charlie", "delta", "echo", "foxtrot"]
    for colluder in ("alpha", "bravo"):
        liar_views = _honest_views_of(result, colluder)
        honest_floor = _min_honest_view(result, honest_ids)
        assert max(liar_views) + RANK_GAP < honest_floor, (
            f"colluder {colluder} not below honest floor: {liar_views} vs {honest_floor:.2f}"
        )
    assert all(t is None for t in result.false_positive_ticks.values())


@pytest.mark.xfail(
    strict=True,
    reason=(
        "ADR 0015: sybil_flood scenario uses pose_lie on alpha (now no-op). "
        "Wave 2 replaces with sybil_flood + range_lie variant. V2 self-anchored "
        "beacon defense still filters sybils — tested separately in "
        "test_sybil_cabal_mutual_gossip_cannot_manufacture_presence."
    ),
)
def test_sybil_flood_collapses_with_low_accept_alpha():
    """Sybil flood: 4 forged identities corroborate alpha's pose-lie.

    Resistance mechanism (no explicit Sybil defense needed):
      - Honest peers vote on each other first (insertion order is
        bravo, charlie, delta, alpha). Each correct vote earns honest
        peers α as observer-matchers and as correct subjects.
      - By the time alpha's cohort fires, honest peers' first-hand
        weight has grown above sybils' priors, so the weighted median
        tips toward honest claims even though sybils outnumber 4:3.
      - Sybils then get blamed as outliers. They never get α from
        voting; record_accept alone (at 0.1 weight) can't sustain trust.

    Result: alpha and all sybils detected, honest peers fully trusted.
    """
    result = run_scenario(scenarios.sybil_flood())

    for attacker_id in result.scenario.attackers:
        attacker_views = _honest_views_of(result, attacker_id)
        assert max(attacker_views) < 0.4, (
            f"attacker {attacker_id} not detected: views={attacker_views}"
        )
        assert result.detection_ticks[attacker_id] is not None
        assert result.detection_ticks[attacker_id] <= 5

    assert all(t is None for t in result.false_positive_ticks.values())


# ---------------------------------------------------------------------------
# Wave 1 — per-attack end_tick scheduling (mirrors TS Attacker.endTick).
# ---------------------------------------------------------------------------


def test_liar_with_end_tick_equivalent_to_explicit_heal():
    """`end_tick` should produce the same recovery trajectory as scheduling
    a manual `heal` event at the disarm tick. We don't require bit-identity
    (cohort timing can drift slightly), but the final healed views must clear
    the same recovery bound the heal-based scenario does."""
    result = run_scenario(scenarios.liar_with_end_tick())
    healed_views = _honest_views_of(result, "alpha")
    assert min(healed_views) > HEALED, (
        f"end_tick-disarmed liar didn't recover toward prior: {healed_views}"
    )
    assert all(t is None for t in result.false_positive_ticks.values())


def test_dual_windowed_attacks_both_recover_after_their_windows_close():
    """Two sensor_fuzz attackers with non-overlapping [start, end_tick) windows.
    The functional proof that per-attacker end_tick disarm works on multiple
    concurrent attackers: both attackers recover toward the prior by the end
    of the run. If end_tick didn't fire for either, the attacker would still
    be corrupting observations and recovery would never happen.

    Detection-threshold timing inside the window is intentionally not asserted
    — accumulated α grows quickly in the 4-corners cluster, so a short fuzz
    burst may not cross the threshold once the swarm is warm. Recovery is
    the robust signal.
    """
    result = run_scenario(scenarios.dual_windowed_attacks())
    healed_alpha = _honest_views_of(result, "alpha")
    healed_bravo = _honest_views_of(result, "bravo")
    assert min(healed_alpha) > HEALED, (
        f"alpha didn't recover after its window closed: {healed_alpha}"
    )
    assert min(healed_bravo) > HEALED, (
        f"bravo didn't recover after its window closed: {healed_bravo}"
    )
    assert all(t is None for t in result.false_positive_ticks.values())


def test_end_tick_rejected_on_swap_key():
    """`swap_key` cannot be auto-disarmed (the original keypair is overwritten
    when rotated). The runner must reject this configuration at scheduling time
    so users get a clear error rather than silent state corruption."""
    bad_scenario = scenarios.Scenario(
        name="invalid_swap_key_window",
        yaml_path=scenarios.YAML,
        n_ticks=10,
        attacks=(scenarios.AttackEvent(1, "swap_key", "alpha", end_tick=5),),
        attackers=("alpha",),
    )
    with pytest.raises(ValueError, match="swap_key"):
        run_scenario(bad_scenario)


def test_end_tick_must_exceed_tick():
    """end_tick=tick is a degenerate window (zero ticks armed) and almost
    certainly a user error. Reject explicitly."""
    bad_scenario = scenarios.Scenario(
        name="invalid_window",
        yaml_path=scenarios.YAML,
        n_ticks=10,
        attacks=(scenarios.AttackEvent(5, "range_lie", "alpha", end_tick=5),),
        attackers=("alpha",),
    )
    with pytest.raises(ValueError, match="end_tick"):
        run_scenario(bad_scenario)
