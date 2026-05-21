ADR 0022: Retroactive trust and singleton-uniqueness
====================================================

Status: Accepted (2026-05-18) — closes the residual gap left by ADRs
0018 + 0020: contributions from a peer that lies *while still trusted*
in territory no other peer ever observes survive both the
exogenous-prior DCS layer (ADR 0018) and the bidirectional residual
loop (ADR 0020).

Context
-------

ADR 0018 wired reputation → SLAM as an exogenous prior on factor
information. ADR 0020 closed the loop by emitting Beta evidence from
SLAM residuals back into the trust evaluator. Together they handle the
two common cases:

1. A peer that lies *now* is downweighted *now* — reputation has
   already collapsed by the time the factor is added, so the prior
   suppresses the contribution at insertion.
2. A peer that lies at any point against geometry observed by an
   honest peer — the residual on shared landmark / inter-robot
   factors spikes, ADR 0020 charges the peer's reputation, the next
   `optimize()` cycle downweights all of that peer's factors.

Neither path covers the **singleton-trusted-window lie**: a peer A
that lies *while still trusted* about a landmark only A ever observes,
then is caught lying about *something else later* (e.g., a range-lie
in a populated region). A's reputation collapses, but:

- ADR 0018 alone froze the singleton factor's information matrix at
  the high reputation A held at insertion time. The frozen path
  is opt-in; the live `_reputation_source` path (ADR 0020 §5) does
  re-read reputation per LM step — but this only helps with the
  weight, not with the **lack of corroborating residual evidence**.
- ADR 0020 emits χ² evidence only for factors whose residual can
  disagree with consensus. A singleton landmark has no consensus to
  disagree with — its own factor fits its own observation with
  residual ≈ 0 in isolation, so χ² stays below `SLAM_CHISQ_OUTLIER`
  (5.991) and no β-evidence flows.

The failure mode is real and bounded: it survives any defense that
relies on (a) retroactive weight re-computation alone or (b) residual
disagreement alone. Closing it requires *both* a re-weighting path
*and* a uniqueness penalty that doesn't depend on having a second
observer.

This ADR specifies the composition of two orthogonal mechanisms,
plus the provenance substrate both need.

Decision
--------

**1. Provenance substrate.** Every `LandmarkFactor`, `InterRobotFactor`,
and `LoopClosureFactor` carries a `Provenance` record stamped at
insertion:

```
@dataclass(frozen=True)
class Provenance:
    reporter_id: str       # mirrors factor.source_id, retained for symmetry
    insertion_tick: int    # monotonic; supplied by caller (sim or runtime)
    reputation_at_insertion: float  # reporter's rep at the moment of add_*
```

`PoseGraph.add_landmark_factor(factor, *, tick: int)` and the
analogous inter-robot / loop-closure methods accept `tick` as a
required keyword argument. Provenance is read by the singleton-cap
and stale-singleton expiration mechanisms; it is otherwise inert,
preserving the byte-exact parity contract when those mechanisms are
disabled.

**2. Singleton confidence cap (P2 Option B).** A landmark is
*singleton-sourced* when the set of distinct `reporter_id` values
across all `LandmarkFactor`s referencing that landmark has cardinality
1. The effective information for such factors is scaled by
`SINGLETON_INFO_SCALE = 0.3` (chosen so the singleton's positional
1σ inflates by `1/√0.3 ≈ 1.83` — equivalent to a 5° → 9° bearing
noise inflation, which is the rough sensitivity reviewers expect
from an unverified single-source measurement).

The cap is applied multiplicatively in `_weight_of`, *after* the
reputation prior and *before* GNC:

```
Ω_eff = singleton_cap · r · w_gnc · Ω_base
```

Justification for the order: reputation gates "does this peer count?",
singleton-cap gates "is this evidence corroborated?", GNC gates "is
the residual statistically consistent?". The three signals are
independent and compose multiplicatively in the M-estimator family
(per ADR 0018 §4's factored-Mahalanobis framing). Order is
mathematically commutative; the listed order matches the order in
which evidence resolves.

The cap is symmetric across all reporters: an honest singleton
observation pays the same 0.3× cost as a malicious one. This is the
intended Bayesian behavior — *uniqueness is itself a confidence
penalty*, regardless of intent. The cost is mild over-conservatism in
genuinely sparse coverage regions.

**3. Stale-singleton expiration (P2 Option C).** A singleton-sourced
factor whose `insertion_tick` is more than `T_CORROBORATE = 200` ticks
behind the current tick *and* still has no second reporter is treated
as stale: its effective information decays on a deterministic
schedule

```
fade(Δt) = max(0.0, 1.0 - (Δt - T_CORROBORATE) / T_FADE)
```

with `T_FADE = 200` ticks (full decay 200 ticks after the corroboration
window expires; 400 ticks total from insertion to zero). The fade
multiplier composes onto `Ω_eff` *after* the singleton cap:

```
Ω_eff = fade · singleton_cap · r · w_gnc · Ω_base
```

When a second reporter eventually adds a corroborating factor, the
singleton status drops, both the cap and the fade are removed
immediately, and the factor returns to full information (subject to
reputation prior + GNC). Determinism preserved: the tick supplied to
`add_*_factor(*, tick=...)` is the only time signal; no wall-clock
dependence.

`T_CORROBORATE` is calibrated to the slowest reasonable
re-observation cadence (a swarm circumnavigating a 50 m perimeter at
0.5 m/s with 5 s tick budget → ~200 ticks per circuit). `T_FADE`
matches; reviewers can tune both via constants in `pose_graph.py`
without touching the LM machinery.

**4. Reputation-tracking switch prior (P1 Option 5 refinement).**
When `weight_mode = "switchable"`, the per-factor prior strength
`γ_i` becomes a function of the reporter's current reputation rather
than a fixed value at registration:

```
γ_i(t) = γ_base · r_now(reporter_i) · GAMMA_REP_SCALE + γ_floor
```

The SC prior `√γ·(1−s)` pulls `s_i` toward 1 (the inlier hypothesis),
so the closed-form optimum under residual `r` is
`s* = γ / (‖r‖² + γ)`. Mapping reputation onto γ in this direction
gives the intended Bayesian behavior:

- **High-rep peer** (`r ≈ 1`): `γ ≈ γ_base · GAMMA_REP_SCALE = 10` →
  strong prior anchors `s ≈ 1` against modest residuals (system trusts
  the report; residual evidence has to be large to override).
- **Low-rep peer** (`r ≈ 0`): `γ ≈ γ_floor = 0.01` → prior is
  effectively off; the closed-form optimum becomes
  `s* ≈ γ_floor / ‖r‖²`, so any residual evidence at all
  (`‖r‖² > γ_floor`) drives the switch toward 0.

Constants: `GAMMA_REP_SCALE = 10.0` (the trust-ratio between fully-rep
and fully-distrusted peers' priors), `γ_floor = 0.01` (keeps
numerical conditioning stable when rep collapses to `REPUTATION_FLOOR`
without making γ identically zero — the SC Hessian's switch diagonal
would then be `‖r‖² + 0 = ‖r‖²`, which is fine but the floor makes
the parity contract less sensitive to exact-zero numerics).

The Jacobian update for the SC prior block in `optimize()` reads
`γ_i(t)` at each LM iteration, so reputation collapse retroactively
releases the prior pressure that previously pinned the switch at 1
— and any residual evidence the optimizer sees in subsequent steps
drives `s_i → 0`, downweighting the factor without re-linearizing
the rest of the graph. This is the **principled retroactive
re-weighting path** for the colluder / sleeper attack class: the
switch variable was always designed to move under prior pressure,
and reputation-as-prior is exactly the shape Sünderhauf 2012 §4
anticipated for "external evidence".

Note this does *not* close the singleton-lie failure mode on its own
(no residual evidence to push `s_i` once the prior releases — the
optimizer happily moves the landmark to fit a single-source factor
with `‖r‖² ≈ 0` regardless of γ). The singleton cap + fade in §§2-3
remain the operative defense in the singleton case; rep-tracking γ
closes the *colluder-with-residual-disagreement* case where the
prior previously prevented SC from acting on accumulated residual
evidence.

**5. Composition with prior ADRs.** Effective per-factor information
in the production default mode (`exogenous` + provenance enabled):

```
Ω_eff = fade(Δt) · singleton_cap · r_now · w_gnc · Ω_base
```

In `switchable` mode with reputation-tracking γ:

```
Ω_eff_data = fade · singleton_cap · s_i² · w_gnc · Ω_base
Ω_eff_prior = γ_i(t)  (per Sünderhauf §3, applied to the s-prior block)
```

The singleton cap and fade compose into *both* modes — they are
upstream of the reputation/SC layer because they encode evidence
sparsity, not evidence quality.

**6. Per-cell provenance in `OccupancyMapMerger`.** Each occupancy
cell maintains a reporter set keyed by cell coordinate. Cells with
singleton reporter sets have their log-odds contribution scaled by
`SINGLETON_INFO_SCALE` and decay under the same `T_CORROBORATE` /
`T_FADE` schedule. This mirrors the pose-graph treatment, keeping
the map and the pose-graph defenses consistent.

Stability
---------

The chicken-and-egg risk from ADR 0020 (rep ↔ residual feedback)
doesn't reappear here: singleton-cap and fade are functions of
*reporter cardinality and insertion tick*, which are independent of
both reputation and residual. Reputation-tracking `γ_i(t)` *is*
reputation-dependent, but the dependence is through the switch
optimization, which has the same convexification path Sünderhauf
proved for fixed `γ` (§5 of the paper). We validate empirically in
`tests/test_pose_graph_switchable.py::test_reputation_tracking_gamma`.

Trade-offs accepted
-------------------

- **Genuinely sparse regions pay the singleton cost.** A drone
  exploring uncharted territory will see honest landmarks
  downweighted by 0.3× until a second drone arrives. This is
  intentional — the system *should* be less confident about
  uncorroborated observations. The cost is principled, not a bug.
- **`T_CORROBORATE = 200` ticks is a calibrated default, not a
  proof.** A swarm with slower revisit cadence (large environment,
  small swarm) might need a longer window; the constant is exposed
  for tuning. Future work: derive `T_CORROBORATE` from observed
  swarm coverage statistics.
- **Reputation-tracking `γ` changes the SC convexification path.**
  The proof in Sünderhauf §5 assumes fixed `γ`; with `γ(t)` the
  per-LM-step optimization is still convex *at that step*, but the
  overall trajectory of `s_i` under changing `γ` is not
  monotonically decreasing. Mitigation: clamp `γ_i(t+1) ≥
  0.5 · γ_i(t)` to bound the prior's rate of change (deferred to a
  follow-on slice — instrumentation first, clamp if empirically
  needed).

Revisit when
------------

- A swarm scenario with revisit cadence > 200 ticks emerges as
  primary use case → recalibrate `T_CORROBORATE` or move it from
  constant to per-scenario config.
- Reviewer pushback on reputation-tracking γ's non-monotone
  trajectory → add the clamp described above, or fall back to
  Option 1 (query-time scaling) on top of fixed-γ SC.
- Active re-observation (P2 Option D from the menu) becomes
  feasible → singleton fade becomes a trigger for re-observation
  tasking rather than a static decay, closing the gap entirely
  rather than bounding it.

Related work and differentiation
--------------------------------

The singleton-uniqueness penalty has a small published literature.
Closest:

- **Vidal-Calleja et al., *Active Control for Single Camera SLAM*,
  ICRA 2006** — argues information-theoretically that
  single-observer landmarks are intrinsically less constrained;
  uses an active-perception policy to seek corroboration. We
  follow the information-theoretic argument but bound the gap
  with a static cap + decay rather than active perception (which
  requires path-planning integration deferred to Phase 3).
- **Triebel & Burgard, *Improving Simultaneous Mapping and
  Localization*, IROS 2005** — early proposal of cell-level
  reporter sets for grid SLAM, used for occupancy fusion only.
  We extend the idea to pose-graph factor weights and tie it to
  the reputation prior + SC composition.
- **Sünderhauf & Protzel 2012 §4 "External Evidence"** — explicitly
  anticipates reputation-as-prior as a use case for the switch
  prior strength `γ`; this ADR is the operationalization.

The combination — **uniqueness-as-confidence-penalty + SC switch
prior tracking exogenous reputation** — is the project's specific
addition. It complements ADRs 0018 + 0020 by closing the failure
mode neither alone addresses.

References
----------

[R1] Sünderhauf & Protzel, *Switchable Constraints for Robust Pose
     Graph SLAM*, IROS 2012.
[R2] Vidal-Calleja, Davison, Andrade-Cetto, Reid, *Active Control
     for Single Camera SLAM*, ICRA 2006.
[R3] Triebel & Burgard, *Improving Simultaneous Mapping and
     Localization*, IROS 2005.
[R4] Agarwal, Tipaldi, Spinello, Stachniss, Burgard, *Robust Map
     Optimization Using Dynamic Covariance Scaling*, ICRA 2013.
[R5] Yang, Antonante, Tzoumas, Carlone, *Graduated Non-Convexity
     for Robust Spatial Perception*, RA-L 2020.
[R6] Kaess, Johannsson, Roberts, Ila, Leonard, Dellaert, *iSAM2:
     Incremental Smoothing and Mapping Using the Bayes Tree*,
     IJRR 2012.
[R7] ADR 0015 (range-only trust voting), ADR 0016 (pose-graph
     substrate), ADR 0018 (reputation as factor prior), ADR 0020
     (bidirectional trust↔SLAM coupling).

Implementation slices
---------------------

This ADR is intentionally full-form. Implementation is sliced for
parity discipline:

- **Slice 1** — failing eval `tests/eval/test_singleton_lie_persistence.py`
  demonstrates the gap (xfail until Slice 4 lands).
- **Slice 2** — provenance substrate: `Provenance` dataclass +
  `tick=` kwarg on add_* methods, no behavior change.
- **Slice 3** — singleton confidence cap in `_weight_of`, gated by
  a `set_singleton_cap(enable=True)` opt-in flag for parity
  preservation in existing tests.
- **Slice 4** — stale-singleton fade; gated by the same flag.
- **Slice 5** — reputation-tracking `γ_i(t)` in SC fork.
- **Slice 6** — `OccupancyMapMerger` per-cell provenance + cap +
  fade.
- **Slice 7** — TS sim-core port (parity fixtures regenerated).
- **Slice 8** — PROGRESS / THREAT_MODEL update with measured bounds.
