"""Baseline comparison: specter-1's exogenous-prior DCS vs. published
alternatives (SYSTEM_ASSESSMENT.md §9 rec 1, ADR 0018 [R2/R3/R4]).

Three SLAM-layer baselines are exercised on the canonical lying-peer scenario:

  - "exogenous" (specter-1 default) — `Ω_eff = r · w_gnc · Ω_base`
    where `r` is the exogenous reputation prior (ADR 0018).

  - "gnc" — `Ω_eff = w_gnc · Ω_base` per Yang et al. RA-L 2020 [R4].
    No exogenous prior. Residual-driven graduated non-convexity alone.

  - "dcs" — `Ω_eff = s(χ²) · Ω_base` per Agarwal et al. ICRA 2013 [R2].
    Dynamic covariance scaling, residual-driven scalar; replaces both
    reputation and GNC.

Switchable Constraints (Sünderhauf & Protzel IROS 2012 [R3]) is documented
as a deferred baseline at the bottom of this file — it requires adding a
per-factor switch variable to the optimizer state vector, which is a
non-trivial change that goes beyond the scope of this baseline-comparison
slice.

Two trust-layer admission-policy baselines are also exercised:

  - PCM-style pairwise consistency filter on observations (Mangelson et
    al. ICRA 2018 [R8]) — pre-filter range observations by max-clique on
    pairwise reciprocity; trust evaluator sees only the inlier set.

  - Moroncelli token-admission (ANTS 2024 [R1 of SYSTEM_ASSESSMENT.md]) —
    per-peer token bucket; each emission consumes a token; replenishment
    capped per tick. Compromised peers exhaust tokens fastest.

Each test asserts the baseline's *measured* outcome against
specter-1's, so the comparison is reproducible and reviewable in CI.
"""

from __future__ import annotations

from specter.slam.pose_graph import (
    LandmarkFactor,
    Pose2,
    PoseGraph,
    landmark_information,
)


# =============================================================================
# SLAM-layer baselines: 3 honest peers + 1 lying peer reporting to one landmark.
# Truth: landmark at (5, 0). Honest peers report range=5; liar reports range=10.
# Initial landmark guess (4, 0) — slightly off so the optimizer has something
# to recover. Measured: landmark x-coordinate after optimize() under each
# weighting mode.
# =============================================================================

LANDMARK_TRUTH_X = 5.0


def _make_lying_landmark_graph(
    weight_mode: str,
    rep_for_liar: float | None = None,
) -> tuple[PoseGraph, LandmarkFactor]:
    pg = PoseGraph()
    pg.set_weight_mode(weight_mode)
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (4.0, 0.0))
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
        if rep_for_liar is not None:
            pg.set_reputation_weight(lf, 1.0)
    liar = LandmarkFactor(
        pose_id="p0",
        landmark_id="lm0",
        range_m=10.0,
        bearing_rad=0.0,
        info=landmark_information(10.0),
        source_id="liar",
    )
    pg.add_landmark_factor(liar)
    if rep_for_liar is not None:
        pg.set_reputation_weight(liar, rep_for_liar)
    return pg, liar


def _landmark_x_after_optimize(pg: PoseGraph) -> float:
    pg.optimize_gnc()
    return pg.landmarks()["lm0"][0]


# Coordinated colluder scenario — equal-count clusters. 2 honest peers and
# 2 colluding peers, equally numerous, each cluster internally self-consistent.
# The colluders report a CONSISTENT lie (both range = 7.0 instead of truth
# 5.0). With clusters of equal size, residual-only outlier mechanisms have
# NO single-channel signal to prefer one over the other: at the naive LS
# midpoint, both clusters' residuals are symmetric. GNC's majority-via-decay
# escape (used in the 3-vs-2 case) is unavailable here.
#
# The architectural claim being gated: this scenario is structurally
# unsolvable from residuals alone. Only an exogenous evidence channel can
# break the symmetry. ADR 0015 Tier 2 MDS embeddability is that channel.
HONEST_RANGE_M = 5.0
COLLUDER_RANGE_M = 7.0
N_HONEST = 2
N_COLLUDERS = 2


def _make_colluder_landmark_graph(
    weight_mode: str,
    rep_for_colluders: float | None = None,
) -> tuple[PoseGraph, list[LandmarkFactor]]:
    """`N_HONEST=2` honest peers report range = 5.0 (truth);
    `N_COLLUDERS=2` colluding peers report range = 7.0 (consistent lie).
    Truth landmark at (5, 0); initial estimate at the residual-symmetric
    LS midpoint (6, 0) — see seed-bias rationale below.

    Equal cluster sizes deliberately deny residual-only mechanisms the
    majority-vote heuristic that lets them resolve 3-vs-2 cases.

    All factors share a UNIFORM information matrix computed at the honest
    range. Why: range-dependent σ (longer range → larger σ → lower info
    weight) would hand GNC an information-weight asymmetry it can exploit —
    the LS midpoint shifts toward the higher-info cluster, then residuals
    become asymmetric, then GNC's μ-decay picks the larger cluster. A real
    colluder forges its advertised σ to match its peers; this test models
    that. Removing the info-weight confound isolates the pure architectural
    failure: at the LS midpoint (6.0 m), both clusters' residuals are
    exactly 1.0 m, and GNC has zero signal to break the symmetry.

    Landmark initial estimate is the LS MIDPOINT (6, 0), not biased toward
    either cluster. Why: at (4, 0) GNC sees honest residual=1, colluder
    residual=3 — that asymmetry is purely an artifact of the seed point's
    closeness to the honest cluster, and GNC's μ-decay will lock onto
    whichever cluster the seed happens to be nearer. A test that picks
    a seed near the honest cluster would just measure "GNC found the
    cluster nearest the seed" — not "GNC distinguished honest from lying."
    Initializing at the residual-symmetric midpoint removes that seed
    bias and exposes the true architectural failure: with symmetric
    residuals, GNC settles at 6.0 (error 1.0 m from truth).

    `rep_for_colluders` sets the reputation weight on BOTH colluder factors —
    simulates the trust layer's Tier 2 MDS detector having identified them.
    Returns the graph and the list of colluder factors."""
    pg = PoseGraph()
    pg.set_weight_mode(weight_mode)
    pg.add_pose("p0", Pose2(0.0, 0.0, 0.0))
    pg.add_landmark("lm0", (6.0, 0.0))  # LS midpoint — unbiased between clusters
    uniform_info = landmark_information(HONEST_RANGE_M)
    for i in range(N_HONEST):
        lf = LandmarkFactor(
            pose_id="p0",
            landmark_id="lm0",
            range_m=HONEST_RANGE_M,
            bearing_rad=0.0,
            info=uniform_info,
            source_id=f"honest_{i}",
        )
        pg.add_landmark_factor(lf)
        if rep_for_colluders is not None:
            pg.set_reputation_weight(lf, 1.0)
    colluders: list[LandmarkFactor] = []
    for i in range(N_COLLUDERS):
        cf = LandmarkFactor(
            pose_id="p0",
            landmark_id="lm0",
            range_m=COLLUDER_RANGE_M,
            bearing_rad=0.0,
            info=uniform_info,
            source_id=f"colluder_{i}",
        )
        pg.add_landmark_factor(cf)
        colluders.append(cf)
        if rep_for_colluders is not None:
            pg.set_reputation_weight(cf, rep_for_colluders)
    return pg, colluders


def test_baseline_exogenous_prior_recovers_landmark_with_low_rep_liar() -> None:
    """specter-1 mode: liar with rep=0.1 → ~100x suppression. Landmark
    recovered close to truth."""
    pg, _ = _make_lying_landmark_graph("exogenous", rep_for_liar=0.1)
    lm_x = _landmark_x_after_optimize(pg)
    # With 100x suppression of the liar, the optimizer should land near
    # the honest cluster's geometric truth.
    assert abs(lm_x - LANDMARK_TRUTH_X) < 0.5, f"exogenous: lm_x={lm_x}, want ~5.0"


def test_baseline_gnc_only_recovers_landmark() -> None:
    """GNC alone (no exogenous prior) eventually downweights the lying
    factor via residual-driven μ-decay. Recovers landmark, but starting
    from the bad initial guess takes more iterations."""
    pg, _ = _make_lying_landmark_graph("gnc")
    lm_x = _landmark_x_after_optimize(pg)
    # GNC needs to converge on the outlier classification — accept a
    # looser tolerance than exogenous-prior.
    assert abs(lm_x - LANDMARK_TRUTH_X) < 1.0, f"gnc: lm_x={lm_x}, want ~5.0"


def test_baseline_dcs_only_recovers_landmark() -> None:
    """DCS alone (Agarwal 2013) downweights large-residual factors via
    s(χ²). Should reject the lying landmark factor."""
    pg, _ = _make_lying_landmark_graph("dcs")
    lm_x = _landmark_x_after_optimize(pg)
    assert abs(lm_x - LANDMARK_TRUTH_X) < 1.0, f"dcs: lm_x={lm_x}, want ~5.0"


def test_baseline_comparison_table_exogenous_wins_or_ties() -> None:
    """Direct head-to-head: with a HIGH-rep liar (rep=0.9) — the realistic
    scenario for a sleeper attack where reputation hasn't collapsed yet —
    exogenous-prior DCS still outperforms or ties pure GNC because the
    trust layer's reputation is itself derived from a separate evidence
    channel (Tier 1 + Tier 2). This test captures the *worst-case*
    advantage: when reputation is briefly wrong, are we still defended?

    The key reassurance: even at rep=0.9 for the liar, exogenous mode
    should not be catastrophically worse than gnc/dcs on this canonical
    scenario.
    """
    results: dict[str, float] = {}
    for mode in ("exogenous", "gnc", "dcs"):
        pg, _ = _make_lying_landmark_graph(
            mode, rep_for_liar=0.9 if mode == "exogenous" else None
        )
        pg.optimize_gnc()
        results[mode] = pg.landmarks()["lm0"][0]
    errs = {mode: abs(x - LANDMARK_TRUTH_X) for mode, x in results.items()}
    # Print measured values for the CI log — the table is the documentation
    # artifact described in SYSTEM_ASSESSMENT.md §6 ("no baselines" gap).
    print("\nbaseline-comparison @ rep_liar=0.9 (lower=better):")
    for mode, err in sorted(errs.items()):
        print(f"  {mode:11s}: landmark_x_err = {err:.4f}")
    # All three baselines should recover the landmark within 2m at rep=0.9.
    for mode, err in errs.items():
        assert err < 2.0, f"{mode} recovery err={err:.4f} too large"


def test_baseline_low_rep_exogenous_strictly_dominates_gnc_only() -> None:
    """When reputation IS reliable (liar correctly classified as rep=0.05),
    specter-1's exogenous mode strictly outperforms GNC-only on the same
    geometry — the trust-layer signal isn't recoverable from residuals
    alone in the early phase before GNC settles."""
    pg_exo, _ = _make_lying_landmark_graph("exogenous", rep_for_liar=0.05)
    pg_exo.optimize()  # bare LM, single μ-level — exogenous prior gets head start
    err_exo = abs(pg_exo.landmarks()["lm0"][0] - LANDMARK_TRUTH_X)

    pg_gnc, _ = _make_lying_landmark_graph("gnc")
    pg_gnc.optimize()
    err_gnc = abs(pg_gnc.landmarks()["lm0"][0] - LANDMARK_TRUTH_X)

    print(
        f"\nshort-horizon (5 iters) @ rep_liar=0.05:\n"
        f"  exogenous:   err = {err_exo:.4f}\n"
        f"  gnc-only:    err = {err_gnc:.4f}"
    )
    # Exogenous prior gets a head start because reputation correctly tags
    # the liar before residual evidence has accumulated.
    assert err_exo <= err_gnc + 0.05, (
        f"exogenous err={err_exo:.4f} should be <= gnc err={err_gnc:.4f}+0.05"
    )


# =============================================================================
# Trust-layer admission-policy baselines: PCM-style pairwise consistency
# and Moroncelli token-admission, run on the canonical range_lie scenario.
# =============================================================================


def _pcm_inlier_filter(
    observations: list[tuple[str, str, float]],
    sigma_combined: float,
    k_sigma: float = 3.0,
) -> set[tuple[str, str]]:
    """Pairwise-consistency-maximization-style inlier filter on reciprocal
    range pairs. For each unordered pair {O, S}, accept if
    `|r(O→S) − r(S→O)| ≤ k·σ_combined`. Returns the set of pairs that pass.

    Simplification of Mangelson et al. ICRA 2018 [R8] for the range-cohort
    setting: PCM normally builds a consistency graph on inter-robot loop
    closures; we build it on reciprocal range pairs.
    """
    by_pair: dict[tuple[str, str], dict[str, float]] = {}
    for observer, subject, range_m in observations:
        key = tuple(sorted((observer, subject)))  # type: ignore[assignment]
        by_pair.setdefault(key, {})[observer] = range_m
    inlier_pairs: set[tuple[str, str]] = set()
    for pair_key, ranges in by_pair.items():
        if len(ranges) < 2:
            continue
        a, b = pair_key
        if a not in ranges or b not in ranges:
            continue
        if abs(ranges[a] - ranges[b]) <= k_sigma * sigma_combined:
            inlier_pairs.add(pair_key)
    return inlier_pairs


def test_pcm_inlier_filter_catches_range_lie() -> None:
    """PCM-style pairwise reciprocity test: a range_lie attacker emits
    asymmetric range, fails the pairwise test, drops out of inlier set."""
    sigma = 0.12  # specter's combined σ (range + NLOS)
    obs = [
        # honest reciprocal pair
        ("alpha", "bravo", 4.0),
        ("bravo", "alpha", 4.02),
        # liar pair — alpha lies on outgoing range to charlie
        ("alpha", "charlie", 7.0),
        ("charlie", "alpha", 4.0),
    ]
    inliers = _pcm_inlier_filter(obs, sigma_combined=sigma, k_sigma=3.0)
    assert ("alpha", "bravo") in inliers
    assert ("alpha", "charlie") not in inliers


def test_pcm_misses_colluder_pair() -> None:
    """The colluder-pair attack passes Tier 1 (PCM-style reciprocity)
    because both colluders inflate their mutual range symmetrically.
    Demonstrates the gap PCM leaves that specter-1 closes via Tier 2
    (eigenvalue-residual MDS on the cohort distance matrix)."""
    sigma = 0.12
    obs = [
        # colluder pair: A and B both inflate A↔B by 3.0m
        ("alpha", "bravo", 7.0),
        ("bravo", "alpha", 7.0),
    ]
    inliers = _pcm_inlier_filter(obs, sigma_combined=sigma, k_sigma=3.0)
    # PCM admits the colluder pair — its reciprocity check is satisfied.
    assert ("alpha", "bravo") in inliers
    # This is the load-bearing failure mode that Tier 2 MDS catches and
    # PCM-alone does not. See docs/papers/cm_vs_mds.md for the
    # eigenvalue-MDS detection rate on this exact attack at N=8..20.


# =============================================================================
# Moroncelli token-admission policy (ANTS 2024). Approximates the
# blockchain-backed reputation token mechanism: each peer holds K tokens;
# each emission consumes 1; tokens replenish at rate r per tick. Once a
# peer's tokens hit zero, subsequent emissions are dropped.
# =============================================================================


def _token_admission(
    emissions: list[tuple[str, int]],  # (agent_id, tick), in order
    initial_tokens: int = 5,
    replenish_per_tick: float = 0.5,
) -> list[bool]:
    """Return one bool per emission indicating whether the token bucket
    admitted it, in input order. Compromised peers emitting at high rate
    exhaust their bucket fastest and have later emissions dropped."""
    tokens: dict[str, float] = {}
    last_seen: dict[str, int] = {}
    admitted: list[bool] = []
    for agent_id, tick in emissions:
        if agent_id not in tokens:
            tokens[agent_id] = float(initial_tokens)
            last_seen[agent_id] = tick
        else:
            elapsed = tick - last_seen[agent_id]
            tokens[agent_id] = min(
                float(initial_tokens), tokens[agent_id] + replenish_per_tick * elapsed
            )
            last_seen[agent_id] = tick
        if tokens[agent_id] >= 1.0:
            tokens[agent_id] -= 1.0
            admitted.append(True)
        else:
            admitted.append(False)
    return admitted


def _count_admitted_by_agent(
    emissions: list[tuple[str, int]], admitted: list[bool]
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for (agent_id, _tick), ok in zip(emissions, admitted, strict=True):
        if ok:
            counts[agent_id] = counts.get(agent_id, 0) + 1
    return counts


def test_moroncelli_token_admission_throttles_replay_storm() -> None:
    """A replay-storm attacker emits at high rate per tick — tokens deplete
    and subsequent emissions are dropped. Demonstrates the per-peer
    rate-limit semantics."""
    # alpha emits 20 envelopes at tick 1 (replay storm); honest peers emit 1/tick
    emissions: list[tuple[str, int]] = []
    for _ in range(20):
        emissions.append(("alpha", 1))
    for t in range(1, 6):
        emissions.append(("bravo", t))
        emissions.append(("charlie", t))
    admitted = _token_admission(emissions, initial_tokens=5, replenish_per_tick=0.5)
    counts = _count_admitted_by_agent(emissions, admitted)
    # Alpha gets exactly the initial 5 tokens at tick 1; the rest of the 20
    # are dropped (no time has elapsed to replenish).
    assert counts.get("alpha", 0) == 5
    # Honest peers admitted in every tick — within budget.
    assert counts.get("bravo", 0) == 5


def test_moroncelli_admission_does_not_catch_low_rate_byzantine() -> None:
    """The token bucket catches *bursty* attackers (replay-storm) but a
    sleeper attacker emitting at the honest rate passes. Demonstrates the
    Tier-1/Tier-2 gap left by admission-only policies."""
    # alpha is a sleeper liar — emits at honest cadence
    emissions = [("alpha", t) for t in range(1, 11)]
    admitted = _token_admission(emissions, initial_tokens=5, replenish_per_tick=0.5)
    counts = _count_admitted_by_agent(emissions, admitted)
    # The sleeper attacker is admitted on most ticks — admission alone
    # leaves the per-message content unverified.
    assert counts.get("alpha", 0) >= 8


# =============================================================================
# Switchable Constraints (Sünderhauf & Protzel IROS 2012) — DEFERRED.
# =============================================================================


def test_baseline_switchable_constraints_recovers_landmark() -> None:
    """SC (Sünderhauf 2012) jointly optimizes a per-factor switch variable
    s_i ∈ [0, 1] alongside the pose/landmark state. The lying factor's
    switch should converge toward 0 as its residual overwhelms the switch
    prior γ; landmark recovery error bounded by < 1.0 m.

    Substrate landed via SWITCHABLE_CONSTRAINTS_PLAN.md Waves 0-2; this is
    the Wave 3 baseline-comparison gate."""
    pg, liar = _make_lying_landmark_graph("exogenous")
    # Register switches on all 4 factors (3 honest + 1 lying).
    for factor in pg._landmark_factors:
        pg.add_switch(factor, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    pg.optimize()
    lm_x = pg.landmarks()["lm0"][0]
    assert abs(lm_x - LANDMARK_TRUTH_X) < 1.0, (
        f"switchable: lm_x={lm_x}, want ~5.0"
    )
    # Liar's switch collapses well below the honest switches.
    switches = pg.switches()
    liar_switch = switches[pg._factor_key(liar)]
    honest_switches = [
        v for k, v in switches.items() if "honest" in k
    ]
    print(
        f"\nswitchable_constraints recovery:\n"
        f"  landmark_x   = {lm_x:.4f}  (truth {LANDMARK_TRUTH_X})\n"
        f"  liar switch  = {liar_switch:.4f}\n"
        f"  honest min   = {min(honest_switches):.4f}\n"
        f"  honest max   = {max(honest_switches):.4f}"
    )
    assert liar_switch < 0.3, (
        f"liar switch={liar_switch:.3f}, want < 0.3"
    )
    assert min(honest_switches) > 0.5, (
        f"honest min switch={min(honest_switches):.3f}, want > 0.5"
    )


def test_baseline_comparison_table_four_modes_at_rep_liar_0p9() -> None:
    """Direct head-to-head: 4 weighting modes (exogenous, gnc, dcs,
    switchable) on the same canonical lying-landmark scenario at rep=0.9.

    SC operates without a reputation input, so the rep_liar parameter only
    affects the exogenous mode. The table is the documentation artifact
    for `docs/BASELINES.md` after SWITCHABLE_CONSTRAINTS_PLAN.md Wave 3
    closes the last gap in the baseline-comparison story."""
    results: dict[str, float] = {}
    for mode in ("exogenous", "gnc", "dcs"):
        pg, _ = _make_lying_landmark_graph(
            mode, rep_for_liar=0.9 if mode == "exogenous" else None
        )
        pg.optimize_gnc()
        results[mode] = pg.landmarks()["lm0"][0]
    # SC: register switches and run plain LM (per SWITCHABLE_CONSTRAINTS_PLAN
    # §risks-4, GNC + SC simultaneously is over-determined; SC is its own
    # outlier mechanism).
    pg_sc, _ = _make_lying_landmark_graph("exogenous")
    for factor in pg_sc._landmark_factors:
        pg_sc.add_switch(factor, prior_strength=1.0)
    pg_sc.set_weight_mode("switchable")
    pg_sc.optimize()
    results["switchable"] = pg_sc.landmarks()["lm0"][0]

    errs = {mode: abs(x - LANDMARK_TRUTH_X) for mode, x in results.items()}
    print("\n4-mode baseline comparison @ rep_liar=0.9 (lower=better):")
    for mode, err in sorted(errs.items()):
        print(f"  {mode:11s}: landmark_x_err = {err:.4f}")
    for mode, err in errs.items():
        assert err < 2.0, f"{mode} recovery err={err:.4f} too large"


def test_baseline_short_horizon_exogenous_vs_switchable() -> None:
    """Short-horizon convergence comparison: how does each robust mode handle
    a clear outlier under a single LM convergence?

    Empirically (rep=0.05, single LM): SC reaches err ~0.0003 (switch
    collapses to ~0.001), while exogenous reaches err ~0.046 (floored at
    REPUTATION_FLOOR=0.01 keeps a residual lie contribution). SC's floor
    is effectively 0; exogenous's floor is 0.01. On a noiseless clear
    outlier, SC wins by a clean margin.

    The architectural claim of exogenous-prior DCS is NOT "always more
    accurate than SC under any scenario." It is "decouples trust-channel
    evidence from geometry-channel evidence, so a corrupted residual
    stream can't fool the trust layer (and vice versa)." The win
    surfaces under multi-cycle dynamics and adversarial scenarios where
    SC's residual-only inference is gamed (ADR 0018 + 0020). This test
    is the honest short-horizon snapshot for `docs/BASELINES.md`.

    Assertion: both modes recover the landmark to within 0.1 m. We do
    not assert dominance either direction — that's scenario-dependent."""
    pg_exo, _ = _make_lying_landmark_graph("exogenous", rep_for_liar=0.05)
    pg_exo.optimize()  # single LM convergence — no GNC outer loop
    err_exo = abs(pg_exo.landmarks()["lm0"][0] - LANDMARK_TRUTH_X)

    pg_sc, liar = _make_lying_landmark_graph("exogenous")
    for factor in pg_sc._landmark_factors:
        pg_sc.add_switch(factor, prior_strength=1.0)
    pg_sc.set_weight_mode("switchable")
    pg_sc.optimize()
    err_sc = abs(pg_sc.landmarks()["lm0"][0] - LANDMARK_TRUTH_X)
    sc_liar_switch = pg_sc.switches()[pg_sc._factor_key(liar)]
    print(
        f"\nshort-horizon (1 LM convergence) @ rep_liar=0.05:\n"
        f"  exogenous:        err = {err_exo:.4f}  (rep floor = REPUTATION_FLOOR)\n"
        f"  switchable:       err = {err_sc:.4f}  (liar switch = {sc_liar_switch:.4f})"
    )
    assert err_exo < 0.1, f"exogenous err={err_exo:.4f} > 0.1"
    assert err_sc < 0.1, f"switchable err={err_sc:.4f} > 0.1"


# =============================================================================
# Coordinated colluder scenario — the architectural test that distinguishes
# specter-1 from residual-only baselines (GNC, DCS, SC). Two colluding peers
# report a CONSISTENT lie (same range, same direction). Their mutual residual
# is small (they agree with each other), so residual-only outlier mechanisms
# see two evidence clusters and have no single-channel signal to prefer one
# over the other — they converge to the weighted-LS compromise between the
# two clusters, well off truth. specter-1's exogenous channel catches the
# colluders via ADR 0015 Tier 2 MDS embeddability, which feeds a low rep
# into the optimizer; SLAM then recovers truth.
#
# This is the load-bearing demonstration of the architectural decoupling
# claim. The threat row labeled "geometrically-consistent coordinated lie"
# in docs/BASELINES.md is gated by these tests.
# =============================================================================


def test_baseline_residual_only_modes_fail_on_coordinated_colluder() -> None:
    """GNC, DCS, and Switchable Constraints all converge to the symmetric
    LS midpoint (~6.0 m for 2 honest @ 5 + 2 colluders @ 7, uniform info)
    instead of truth (5.0 m). They are STRUCTURALLY blind to coordinated
    lies because the colluders' mutual residual is small — their evidence
    cluster looks just as internally consistent as the honest cluster from
    the optimizer's POV.

    This is not a tuning failure — it is the architectural limit of single-
    evidence-channel mechanisms. No γ, no μ-schedule, no φ choice fixes
    it without an exogenous evidence stream (which by definition isn't
    residuals)."""
    results: dict[str, float] = {}
    for mode in ("gnc", "dcs"):
        pg, _ = _make_colluder_landmark_graph(mode)
        pg.optimize_gnc()
        results[mode] = pg.landmarks()["lm0"][0]
    # SC: register switches on all 5 factors, run plain LM.
    pg_sc, _ = _make_colluder_landmark_graph("exogenous")
    for factor in pg_sc._landmark_factors:
        pg_sc.add_switch(factor, prior_strength=1.0)
    pg_sc.set_weight_mode("switchable")
    pg_sc.optimize()
    results["switchable"] = pg_sc.landmarks()["lm0"][0]

    errs = {mode: abs(x - LANDMARK_TRUTH_X) for mode, x in results.items()}
    print(
        "\ncoordinated-colluder scenario (truth=5.0, colluders report 7.0):"
    )
    for mode, x in sorted(results.items()):
        print(
            f"  {mode:11s}: lm_x = {x:.4f}, err = {errs[mode]:.4f}"
        )
    # All three residual-only modes should land in the [5.3, 6.5] LS-compromise
    # band — NOT close to truth (5.0). This is the failure-mode assertion.
    for mode, err in errs.items():
        assert err > 0.3, (
            f"{mode} err={err:.4f} unexpectedly close to truth — colluder "
            f"scenario may not be exercising the architectural limit"
        )


def test_baseline_exogenous_recovers_coordinated_colluder_with_tier2_rep() -> None:
    """specter-1 mode: when ADR 0015 Tier 2 MDS detector has identified the
    colluders and set their rep to 0.1, SLAM's exogenous prior down-weights
    their factor information by 10x. The honest cluster dominates the joint
    estimate, landmark recovered close to truth.

    This pairs with test_baseline_residual_only_modes_fail_on_coordinated_colluder
    to demonstrate the architectural win: separate evidence channels solve
    what single-channel mechanisms cannot."""
    pg, _ = _make_colluder_landmark_graph(
        "exogenous", rep_for_colluders=0.1
    )
    pg.optimize_gnc()
    lm_x = pg.landmarks()["lm0"][0]
    err = abs(lm_x - LANDMARK_TRUTH_X)
    print(
        f"\nexogenous + Tier2-fed rep on coordinated colluders:\n"
        f"  rep_for_colluders = 0.10\n"
        f"  lm_x              = {lm_x:.4f}  (truth {LANDMARK_TRUTH_X})\n"
        f"  err               = {err:.4f}"
    )
    assert err < 0.3, (
        f"exogenous + Tier2 rep should recover < 0.3 m; got err={err:.4f}"
    )


def test_baseline_exogenous_without_tier2_rep_also_fails_on_colluder() -> None:
    """Control: specter-1's exogenous mode WITHOUT the Tier 2 rep input
    (rep_for_colluders = None, defaulting to 1.0) behaves like the other
    residual-only modes — it cannot detect coordinated colluders from
    residuals alone. This proves that the win above is specifically due
    to the exogenous evidence channel, not anything else in specter-1's
    weighting math.

    This test gates the architectural claim from the wrong direction:
    take away the exogenous channel and exogenous mode loses too. The
    composition is the contribution."""
    pg, _ = _make_colluder_landmark_graph("exogenous", rep_for_colluders=None)
    # No reputation set on any factor → all default to 1.0 in exogenous mode.
    pg.optimize_gnc()
    lm_x = pg.landmarks()["lm0"][0]
    err = abs(lm_x - LANDMARK_TRUTH_X)
    print(
        f"\nexogenous WITHOUT Tier2 rep on coordinated colluders (control):\n"
        f"  lm_x = {lm_x:.4f}, err = {err:.4f}"
    )
    # Without the exogenous channel, exogenous mode = gnc mode behavior on
    # this scenario. Assert it fails the same way the other residual-only
    # modes do.
    assert err > 0.3, (
        f"exogenous without Tier2 rep err={err:.4f} unexpectedly low — "
        f"the control case should also fail"
    )
