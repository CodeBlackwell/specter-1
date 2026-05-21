ADR 0018: Reputation as factor-information prior (exogenous-prior DCS)
=======================================================================

Status: Accepted (2026-05-17) — SLAM_PLAN.md Wave 4. Locks the precise
reputation → factor-weight mapping that ADR 0016 §3 deferred.

Context
-------

ADR 0016 §3 frames the project's contribution as **exogenous-prior
Dynamic Covariance Scaling** — `Ω' = r · Ω` where the scaling factor
`r ∈ [0, 1]` comes from the trust evaluator (ADR 0015 range-only
voting) rather than from residual statistics as in standard DCS
(Agarwal et al. ICRA 2013 [R2]).

This ADR pins:

1. The precise reputation → `r` mapping (currently `r := reputation`,
   but the literature suggests low-rep peers may need non-linear
   shaping to fully suppress).
2. The composition rule with GNC's Geman-McClure weight `w_gnc`:
   effective per-iteration information is `r · w_gnc · Ω` per ADR 0016
   §8. Order: reputation first (set at insertion, frozen), GNC second
   (updated each μ-level).
3. The frozen-at-insertion contract (ADR 0016 §4): reputation lookup
   happens once when the factor is added; subsequent reputation
   evolution does not re-weight old factors.

Decision
--------

**1. Reputation → r mapping.** Identity in Phase 1: `r := reputation`,
clamped to `[r_floor, 1.0]` where `r_floor = 0.01` prevents complete
factor exclusion (keeps Hessian sparsity stable). For very-low-rep peers
(rep < 0.2), this is a tighter contribution than DCS's residual-derived
scaling would naturally give — exactly the point of using an exogenous
prior. The literature (Olson 2013 [R1] Max-Mixtures) supports
multi-hypothesis weighting; we instead use the single-hypothesis
prior because the trust layer's per-cohort Tier 1 + Tier 2 verdict is
itself a multi-evidence Bayesian estimate.

**2. Composition order: reputation × GNC × Ω.** Effective information
matrix at iteration k, μ-level m:
```
Ω_eff = r_factor · w_gnc(k, m) · Ω_base
```
This order matters: reputation is **frozen** (ADR 0016 §4), GNC weight
varies per μ-level. Multiplying in this order means:
- Reputation gates "how much does this factor count if it's an inlier?"
- GNC then asks "is it actually an inlier at this μ-level?"
- A high-rep liar (rep ≈ 1, but observation is a lie) is still caught
  by GNC's residual-driven μ-decay.
- A low-rep peer whose observation happens to be consistent gets less
  weight than a high-rep peer with the same observation — exactly the
  desired Bayesian behavior.

**3. Frozen-at-insertion (per ADR 0016 §4).** Reputation looked up once
when factor is added; not re-weighted as reputation evolves. The
sliding window ages out bad factors within ~50 keyframes (ADR 0016
§10). This is the MVP-speed tradeoff documented in ADR 0016 §4 — not
the principled long-term answer (which is iSAM2-style re-linearization).

**4. Mahalanobis-type tests on factored evidence streams.** Both
layers apply Mahalanobis-type statistical machinery to their own
evidence stream: the trust evaluator computes
`|r(O→S) − r(S→O)| / σ_combined` on reciprocal range pairs (ADR 0015
Tier 1) and per-point residuals on the eigenvalue-decomposed cohort
distance matrix (Tier 2); the SLAM layer computes `‖r‖²_Ω_eff` on
pose-graph factor residuals. These are *different statistics on
different evidence streams* — Tier 1 is a scalar reciprocity check,
Tier 2 a vector embeddability residual, and the SLAM residual a
multivariate constraint mismatch — but all three share the
M-estimator family and produce comparable per-observation outlier
scores. This is what makes the architecture coherent: SLAM and trust
are not competing detection paths on the same data; they are
factored Bayesian estimators on independent evidence streams, joined
only through the scalar reputation prior `r ∈ [0, 1]` per ADR 0016
§2's no-double-counting constraint.

Consequences
------------

Positive:

- A peer that lies via `pose_lie` (inter-robot or landmark observations
  inconsistent with truth, but not range-lying — caught at SLAM layer
  per ADR 0015) has its factor information downweighted from the trust
  layer in real-time. With reputation ≈ 0.1, the lying factor's
  effective weight is 0.01 of an honest factor's — 100× suppression
  before GNC even fires.
- Composition with GNC is multiplicative + commutative-in-effect:
  trust evidence and residual evidence compose without double-counting,
  per ADR 0016 §2's "no double-counting" constraint.
- The factored-Mahalanobis framing (§4) makes the architecture
  legible to reviewers familiar with M-estimator-based robust SLAM:
  this is DCS with an exogenous prior whose source is a Bayesian
  evaluator running on a separate evidence channel, not an ad-hoc
  kludge.

Trade-offs accepted (superseded — see §Composition update below):

- **Frozen weights** mean a rapid trust collapse doesn't retroactively
  fix old optimizations. Documented in ADR 0016 §4 as the MVP-speed
  tradeoff. iSAM2 [R5] re-linearization is the principled long-term
  answer; deferred.
- **One-way trust → SLAM** means SLAM residuals do *not* feed back
  to the trust evaluator in Phase 1 (ADR 0016 §2). A peer that lies
  *only* through factor-level distortion (without triggering Tier 1/2)
  is detected at the SLAM layer but doesn't accumulate Beta evidence
  at the trust layer. Bidirectional coupling is a documented Phase 2+
  research direction with preservation hooks per ADR 0016 §2.

Composition update (2026-05-18 — ADRs 0020 + 0022 supersession)
---------------------------------------------------------------

The two trade-offs above were the load-bearing limitations of this ADR
at v1. Both are now closed by follow-on ADRs without changing the
exogenous-prior framing this ADR locks in:

- **Frozen weights → retroactive composition.** ADR 0020 §5
  (un-frozen rep) added a live `set_reputation_source` callable that
  `_weight_of` queries per LM step — so the effective `r_now` for any
  factor reflects the current Beta(α,β) verdict, not the rep at
  insertion. ADR 0022 §4 then makes the analogous move for the
  Switchable Constraints fork: the per-factor switch prior strength
  `γ_i(t) = γ_base · r_now · GAMMA_REP_SCALE + γ_floor` reads `r_now`
  every LM step, so reputation collapse releases the SC prior that
  previously pinned `s_i = 1` and the optimizer drives the switch
  toward 0 under accumulated residual evidence. ADR 0022 §§2–3 add
  the singleton confidence cap + stale-singleton fade to close the
  *uncorroborated*-lie case where no residual evidence accrues against
  a then-trusted peer's report of a landmark only they observe.
- **One-way → bidirectional.** ADR 0020 §1 closes the loop: SLAM
  factor residuals at converged solution emit Beta evidence directly
  into the trust evaluator via `slam_residual_evidence`, validated
  stable across ≥5 full cycles in
  `tests/test_pose_graph_bidirectional_trust.py`.

iSAM2 [R5] remains the gold-plate principled answer for fluid
relinearization but is **no longer load-bearing**: the composition
`fade · singleton_cap · r_now · w_gnc · Ω_base` (ADR 0022 §5) covers
the practical cases iSAM2 was reserved for, at significantly lower
complexity. iSAM2 is retained as an explicit "expensive escape valve"
in ADR 0022 §Revisit-when, triggered only if reviewer pushback emerges
on switch-prior dynamics under fast-changing reputation.

Composition rule at production default (`weight_mode = "exogenous"`,
ADR 0022 cap+fade enabled):

```
Ω_eff = fade(Δt) · singleton_cap · r_now · w_gnc · Ω_base
```

Each multiplicative term has a citation, an independent evidence
channel, and an opt-in gate preserving the byte-exact parity contract
when disabled. The Bayesian framing from §2 above is preserved —
reputation still gates "how much does this factor count if it's an
inlier"; the additions are orthogonal evidence channels (uniqueness,
staleness) the M-estimator family composes naturally.

Revisit when
------------

- Wave 4 evals show identity mapping `r := reputation` doesn't suppress
  fast-flipping liars within the marginalization window. Would force
  a non-linear shaping (e.g., `r' = reputation^k` with `k > 1` to
  steepen the low-rep tail).
- Wave 4 evals show GNC + reputation prior composition has unexpected
  interactions (e.g., a high-rep peer with a small-residual lie gets
  weighted higher than a low-rep peer with a zero-residual truth —
  technically the desired Bayesian outcome but may be pedagogically
  confusing).

Related work and differentiation
--------------------------------

The closest published threat to the novelty of exogenous-prior DCS and
the trust↔SLAM decoupling is catalogued here. Full citations live in
`docs/SYSTEM_ASSESSMENT.md` §10.

- **Moroncelli, Pacheco, Strobel, Lajoie, Dorigo, Reina, *Byzantine
  Fault Detection in Swarm-SLAM Using Blockchain and Geometric
  Constraints*, ANTS 2024** (closest threat to per-peer reputation
  modulating a SLAM optimizer). Moroncelli et al. manage continuous
  reputation tokens via a blockchain-based smart contract and use them
  to govern the "proportion of validated loop closures that are used
  in Swarm-SLAM's PGO." This system shares specter-1's motivation
  (per-peer reputation against Byzantine loop-closure attacks) but
  differs architecturally along three load-bearing dimensions:
  (1) **reputation as admission filter vs. factor weight** —
  Moroncelli's reputation controls *which* loop closures enter the PGO;
  specter-1's reputation enters the optimizer as a continuous
  multiplicative information-matrix scalar (`Ω_eff = r · w_gnc · Ω_base`,
  §2 above) so an admitted lying factor is still suppressed in
  proportion to the liar's reputation, rather than fully counted once
  admitted; (2) **endogenous vs. exogenous evidence channel** —
  Moroncelli's reputation is derived from geometric peer-review of the
  loop closures themselves (the same evidence stream the optimizer
  consumes), so detection and estimation share statistics; specter-1's
  reputation comes from a **separate evidence channel** (reciprocal-range
  voting + MDS embeddability, ADR 0015) with no shared statistics, per
  the no-double-counting constraint of ADR 0016 §2; (3) **mechanism vs.
  infrastructure** — Moroncelli's framing centers on the blockchain
  smart contract and ROS2 integration as the trust-management
  substrate; specter-1's framing centers on the soft, continuous,
  exogenous-prior covariance-scaling composition rule (`r · w_gnc · Ω`
  with reputation frozen at insertion, GNC adapting per μ-level, and
  sliding-window keyframe ageout as the staleness mitigation), with
  signed envelopes + Beta(α,β) standing in for the smart-contract
  layer.

  Empirically, Moroncelli et al. evaluate against 10 m, random, and
  1 m loop-closure perturbations. Specter-1's eval battery covers a
  wider attack surface (range-lie, colluder-pair, COP-layer attacks,
  Sybil cabal, sleeper-then-attack) at the cost of currently lacking
  head-to-head measurements on a shared scenario. Closing that
  measurement gap is the explicit subject of `SYSTEM_ASSESSMENT.md` §9
  recommendation 1 and the forthcoming `tests/eval/test_baselines.py`.

- **Sünderhauf & Protzel, *Switchable Constraints for Robust Pose
  Graph SLAM*, IROS 2012** (closest published SLAM-layer alternative
  to exogenous-prior DCS — same scalar per-factor weighting shape,
  different evidence channel). Switchable Constraints (SC) introduces
  a per-factor switch variable `s_i ∈ [0, 1]` that is **jointly
  optimized** with the pose/landmark state. Each switchable factor
  contributes (a) a data residual scaled by `s_i` and (b) a prior
  residual `√γ_i · (1 - s_i)` pulling `s_i` toward 1. The optimizer
  trades data fit against the prior; large geometric residuals push
  `s_i → 0`, suppressing the factor.

  Architectural difference vs. exogenous-prior DCS:
  - **Endogenous vs. exogenous weighting source.** SC's `s_i` is
    optimized from the residual statistics already feeding the
    optimizer — *one evidence channel, two outputs* (the state and
    the weights). Exogenous-prior DCS sources its scalar `r` from a
    separate evidence channel (ADR 0015 range-only voting) and treats
    it as a prior fed into the optimizer — *two evidence channels,
    no shared statistics*. This separation is the ADR 0016 §2
    no-double-counting constraint; SC violates it by design.
  - **Convergence cost.** SC adds `n_switchable` extra state
    variables; the LM step must converge them alongside poses and
    landmarks. Exogenous-prior DCS keeps the state vector at its
    base size (no switch variables); reputation enters as a fixed
    per-factor scalar.
  - **Use of trust evidence.** SC has no notion of cross-agent trust
    — it is a single-agent / single-bus robust-PGO mechanism. The
    multi-agent extension would re-derive trust from residuals, which
    is exactly the loop ADR 0015 + 0020 close differently.

  Implementation lives behind `PoseGraph.set_weight_mode("switchable")`
  (Wave 0 design defaults: linear `ψ(s) = s` per Sünderhauf §4 — the
  paper's Table II default, with the sigmoid variant deferred as it
  addresses convergence pathologies that don't apply to our
  lying-landmark scenario; additive update + `[0, 1]` clamping per §4;
  `γ = 1.0` default; all factor types switchable — the paper restricts
  to loop closures but the math is type-agnostic and our scenario uses
  lying landmark factors). Head-to-head numbers vs. specter-1's
  exogenous-prior mode land in `docs/BASELINES.md` alongside the
  existing GNC + DCS baseline comparisons.

  **Architectural gate (2026-05-17):** the endogenous-vs-exogenous
  distinction is empirically measured in
  `tests/eval/test_baselines.py::test_baseline_residual_only_modes_fail_on_coordinated_colluder`.
  Scenario: 2 honest peers report `range = 5.0`, 2 colluders report
  `range = 7.0` with forged uniform σ; landmark initialized at the LS
  midpoint `(6, 0)` to eliminate seed bias. Both clusters' residuals
  at the midpoint are exactly 1.0 m — symmetric in the residual stream.
  GNC, DCS, and SC each settle at 6.0 m (err = 1.0 m, stuck at the
  symmetric LS midpoint). Exogenous mode with Tier 2 MDS-derived
  `rep_for_colluders = 0.1` recovers truth (err = 0.0 m). The control
  case (exogenous WITHOUT Tier 2 rep) also fails at 1.0 m, proving the
  win is the *evidence channel*, not the *weighting mode*. This is the
  load-bearing empirical demonstration that endogenous mechanisms are
  structurally blind to coordinated lies and exogenous mechanisms are
  not — no tuning of γ, μ-schedule, or φ can break a residual
  symmetry that is symmetric by construction.

Related
-------

- ADR 0015 — Range-only trust voting. Sources `reputation` for the
  exogenous prior.
- ADR 0016 — Pose-graph substrate. §3 frames exogenous-prior DCS; §4
  locks frozen-at-insertion; §8 specifies GNC; §11 (parity) gates the
  composition order.
- ADR 0017 — Loop closure detection. Closure factors are gated by the
  same reputation prior — a lying peer's closure proposal is
  downweighted before LM ingestion.
