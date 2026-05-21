# Baseline Comparison — specter-1 vs. Published Alternatives

**Date:** 2026-05-17
**Status:** Initial baseline implementation per `SYSTEM_ASSESSMENT.md` §9 recommendation 1. Closes the "no baselines" gap that was the single largest competence concern pre-funding.

This document captures head-to-head measurements between specter-1's defensive mechanisms and the closest published alternatives, on shared scenarios. Every claim of relative advantage cites a specific test in `tests/eval/test_baselines.py` and a measured number. Numbers are reproducible with `uv run pytest tests/eval/test_baselines.py -v -s`.

---

## What is measured

Two layers of baseline comparison:

1. **SLAM-layer:** the per-factor weighting strategy inside the pose-graph optimizer. Specter-1's exogenous-prior DCS (ADR 0018) compared against pure GNC (Yang et al. RA-L 2020), pure DCS (Agarwal et al. ICRA 2013), and Switchable Constraints (Sünderhauf & Protzel IROS 2012, deferred).

2. **Trust-layer admission policy:** what happens *before* observations reach the trust evaluator. Specter-1's Beta-reputation (with Tier 1 reciprocal-range + Tier 2 MDS embeddability) compared against PCM-style pairwise consistency (Mangelson et al. ICRA 2018) and Moroncelli token-admission (ANTS 2024).

---

## SLAM-layer — per-factor weighting strategy

### Scenario

3 honest peers each report `range = 5.0` to a landmark; 1 lying peer reports `range = 10.0`. Truth: landmark at `(5, 0)`. Initial estimate `(4, 0)`. Measure landmark `x` recovery after optimization.

### Measured results

**Long horizon (full GNC outer loop, 8–15 μ-levels):**

| Mode | Liar reputation | Landmark `x` error |
|---|---|---|
| `exogenous` (specter-1) | 0.10 | < 0.5 m |
| `gnc` (Yang 2020) | n/a (no rep) | < 1.0 m |
| `dcs` (Agarwal 2013) | n/a (no rep) | < 1.0 m |
| `switchable` (Sünderhauf 2012) | n/a (no rep) | < 1.0 m |

All four modes converge given enough iterations. **At long horizon with a low-rep liar, all four robust modes recover.** Each test asserts the bound; see `test_baseline_exogenous_prior_recovers_landmark_with_low_rep_liar`, `test_baseline_gnc_only_recovers_landmark`, `test_baseline_dcs_only_recovers_landmark`, `test_baseline_switchable_constraints_recovers_landmark`.

**High-rep liar, full optimizer (the realistic sleeper-attack regime, before Tier 1 has caught up):**

```
4-mode baseline comparison @ rep_liar=0.9 (lower=better):
  dcs        : landmark_x_err = 0.0000
  exogenous  : landmark_x_err = 0.0001
  gnc        : landmark_x_err = 0.0001
  switchable : landmark_x_err = 0.0003
```

When the trust signal is briefly *wrong* (rep_liar=0.9 even though the peer is lying), all four modes converge to the same recovery within 1 mm. The trust prior doesn't make things worse when it's wrong (exogenous = gnc); SC also recovers because its switch variable is residual-driven and doesn't consume the rep input. Test: `test_baseline_comparison_table_four_modes_at_rep_liar_0p9`.

**Short horizon (bare LM, no GNC outer-loop convergence), low-rep liar:**

```
short-horizon (5 iters) @ rep_liar=0.05:
  exogenous:   err = 0.0464
  gnc-only:    err = 0.7895

short-horizon (1 LM convergence) @ rep_liar=0.05:
  exogenous:        err = 0.0464  (rep floor = REPUTATION_FLOOR = 0.01)
  switchable:       err = 0.0003  (liar switch = 0.0010)
```

Two short-horizon comparisons:

- **vs. GNC-only** (`test_baseline_low_rep_exogenous_strictly_dominates_gnc_only`): **17× advantage for specter-1's exogenous prior over pure GNC** in the early phase. When residual evidence hasn't yet accumulated for GNC to settle on the outlier classification, the exogenous prior — sourced from a *separate* evidence channel (Tier 1 reciprocal range + Tier 2 MDS) — gives the optimizer a head start.

- **vs. Switchable Constraints** (`test_baseline_short_horizon_exogenous_vs_switchable`): SC converges the switch to ~0.001 in one LM run, while exogenous's contribution is floored at `REPUTATION_FLOOR=0.01`. On this clean noiseless single-outlier scenario, **SC has a small numerical edge from the lower effective floor**. The asymmetry is hyperparameter-driven (REPUTATION_FLOOR vs. switch's mathematical floor at 0), not architectural.

The load-bearing architectural claim is **not** "exogenous always wins on accuracy." It is: *exogenous-prior DCS decouples the trust-evidence channel from the geometry-evidence channel*, so the two channels cannot fool each other through residual feedback. SC operates on residual statistics alone — a Byzantine adversary that crafts geometrically-consistent lies (e.g., a coordinated colluder pair whose joint residual is small) is invisible to SC by construction. The decoupling matters *most* in scenarios the single-residual-channel approach cannot detect, which the simple lying-landmark scenario does not exercise. See ADR 0018's "Related work and differentiation" subsection for the architectural argument, and the coordinated-colluder section below for the empirical gate.

### Coordinated colluders — the architectural failure (measured)

The lying-landmark scenario above gives every robust mode a clean residual signal (1 outlier, 3 inliers). The architectural claim of exogenous-prior DCS is that it survives when the residual signal *itself* is symmetric — i.e. when colluders construct a lie that looks just as internally consistent as the honest cluster. The scenario:

- 2 honest peers report `range = 5.0` (truth)
- 2 colluding peers report `range = 7.0` (consistent lie)
- All factors share uniform information (colluders forge their advertised σ)
- Landmark initialized at the LS midpoint `(6, 0)` to remove seed-bias confounds

At the LS midpoint, both clusters' residuals are exactly 1.0 m. GNC's μ-decay, DCS's φ-weighting, and SC's switch-variable have **no signal to break the symmetry** — they each settle at 6.0 m, 1.0 m off truth. Specter-1's exogenous channel, fed a Tier 2 MDS-derived `rep_for_colluders = 0.1`, breaks the symmetry from outside the residual stream:

```
coordinated-colluder scenario (truth=5.0, colluders report 7.0):
  dcs        : lm_x = 6.0000, err = 1.0000
  gnc        : lm_x = 6.0000, err = 1.0000
  switchable : lm_x = 6.0000, err = 1.0000

exogenous + Tier2-fed rep on coordinated colluders:
  rep_for_colluders = 0.10
  lm_x              = 5.0000  (truth 5.0)
  err               = 0.0000

exogenous WITHOUT Tier2 rep on coordinated colluders (control):
  lm_x = 6.0000, err = 1.0000
```

Three tests gate this:

- `test_baseline_residual_only_modes_fail_on_coordinated_colluder` — asserts gnc/dcs/switchable err > 0.3 m. The failure-mode assertion.
- `test_baseline_exogenous_recovers_coordinated_colluder_with_tier2_rep` — asserts exogenous err < 0.3 m with Tier 2 rep input. The recovery assertion.
- `test_baseline_exogenous_without_tier2_rep_also_fails_on_colluder` — control: exogenous mode WITHOUT Tier 2 rep degenerates to residual-only behavior (err = 1.0 m). Proves the win is the *channel*, not the *mode*.

Why this is "architectural, not tuning": no choice of γ (DCS), μ-schedule (GNC), or φ (SC) can break a symmetry that is symmetric in the residual stream itself. The only way to break it is with evidence that **didn't come from residuals** — which is precisely what ADR 0015 Tier 2 MDS embeddability supplies. This test is the empirical gate on that claim.

---

## Trust-layer — admission policy

### PCM-style pairwise consistency

PCM (Mangelson et al. ICRA 2018) filters inter-robot loop closures by pairwise consistency, admitting only the maximum-clique inlier set. The natural analog for the range-cohort threat model is to filter reciprocal range pairs: accept `(O, S)` if `|r(O→S) − r(S→O)| ≤ k·σ_combined`.

**Catches range_lie (asymmetric attack):**
```
test_pcm_inlier_filter_catches_range_lie  PASS
```

The PCM-style filter correctly excludes the lying pair `(alpha, charlie)` where the reciprocal disagrees by 3 m. Equivalent to specter-1's Tier 1 reciprocal-range voting.

**Misses colluder_pair (symmetric attack):**
```
test_pcm_misses_colluder_pair  PASS  (asserts colluder pair admitted)
```

When colluders A and B both inflate their mutual range by 3 m, the reciprocal check is *satisfied* — both sides agree. PCM admits the colluder pair as an inlier. This is the load-bearing failure mode that specter-1's Tier 2 MDS embeddability catches and PCM-alone does not. See `docs/papers/cm_vs_mds.md` for the eigenvalue-MDS detection rate on this exact attack (100% top-2 attribution at `N ≥ 10`).

### Moroncelli token-admission (ANTS 2024)

Per-peer token bucket: each peer holds `K` tokens (default 5); each emission consumes 1; tokens replenish at rate `r` per tick (default 0.5). Approximates the blockchain-backed reputation token mechanism.

**Catches replay_storm:**
```
test_moroncelli_token_admission_throttles_replay_storm  PASS
```

An attacker emitting 20 envelopes at tick 1 (a replay storm) gets exactly 5 admitted — the initial token bucket — and the next 15 are dropped. Demonstrates the per-peer rate-limit semantics.

**Misses sleeper-rate Byzantine:**
```
test_moroncelli_admission_does_not_catch_low_rate_byzantine  PASS  (asserts ≥8 admitted)
```

An attacker emitting at the *honest cadence* (1/tick) is admitted on every tick. Token admission alone does not inspect message content — it's an orthogonal defense. Specter-1's Beta-reputation evaluator, by contrast, evaluates the *content* of each observation against the cohort geometry; a sleeper attacker is caught the first tick they emit an inconsistent range, regardless of rate.

---

## Synthesis

| Threat | PCM | Moroncelli token-admission | GNC-only | DCS-only | Switchable (Sünderhauf) | specter-1 (exogenous + Tier 1 + Tier 2 + V3) |
|---|---|---|---|---|---|---|
| `range_lie` (asymmetric) | ✓ catches | ✗ rate-limit miss | ✓ catches (long-horizon) | ✓ catches | ✓ catches (long-horizon) | **✓ catches in 1–3 ticks** |
| `colluder_pair` (symmetric) | ✗ admits | ✗ admits | ✓ catches (long-horizon) | ✓ catches | ✓ residual-driven (geometrically) | **✓ Tier 2 catches in 5–10 ticks at σ=0.1m, 100% attribution at N≥10** |
| `replay_storm` (envelope burst) | n/a (filter is per-msg content) | ✓ rate-limits | ✗ envelopes not seen by optimizer | ✗ envelopes not seen by optimizer | ✗ envelopes not seen by optimizer | **✓ replay window rejects every replay** |
| `pose_lie` (self-pose only) | n/a | ✗ admits | ✗ no map effect | ✗ no map effect | ✓ if pose factor switchable | **closed-loop ADR 0020 via slam_residual_evidence; map-merger anomaly** |
| `sybil_cabal_mutual_gossip` | ✗ admits | ✗ admits | ✗ no Sybil concept | ✗ no Sybil concept | ✗ no Sybil concept | **✓ V3 transitive presence rule** |
| Geometrically-consistent coordinated lie (2 colluders @ 7m vs 2 honest @ 5m, symmetric residuals) | ✗ admits | ✗ admits | **✗ err = 1.0 m** (stuck at LS midpoint) | **✗ err = 1.0 m** | **✗ err = 1.0 m** | **✓ err = 0.0 m** with Tier 2 rep=0.1 (without rep: err = 1.0 m, control) |
| Short-horizon map distortion (rep correctly tagged) | n/a | n/a | err = 0.7895 m | (long-horizon eq.) | err = 0.0003 m (single LM) | **err = 0.0464 m** (REPUTATION_FLOOR-bounded) |

**The composite picture:** every published baseline catches *some* threat class but not all. Specter-1's contribution is the *composition*: range-only reciprocal voting (Tier 1) + MDS embeddability (Tier 2) + V3 transitive presence + signed envelopes + replay window + exogenous-prior DCS in the optimizer + bidirectional residual evidence (ADR 0020) + singleton-uniqueness cap + stale-singleton fade (ADR 0022) + reputation-tracking SC switch prior (ADR 0022 §4). No published baseline closes all seven threats listed above; the singleton-trusted-window-lie failure mode (a peer that lies *while still trusted* about a landmark only they ever observe, then is caught lying about something else later) is closed by the ADR 0022 cap+fade layer specifically — residual-only mechanisms (GNC, DCS, SC) and reputation-only mechanisms (the v1 `r · w_gnc · Ω` composition) are both structurally blind to it. The architectural decoupling (`SYSTEM_ASSESSMENT.md` §5) is what makes this composition coherent — each layer operates on its own evidence stream and contributes to the others only through the scalar reputation prior, the per-cell/per-factor reporter set, and the deterministic insertion-tick clock.

**On the SC short-horizon win:** SC's single-LM err (0.0003 m) beats exogenous's (0.0464 m) on this clean noiseless scenario because SC's switch floor is mathematical 0 while exogenous's `REPUTATION_FLOOR=0.01` keeps a residual 1% contribution from the liar. This is hyperparameter-driven, not architectural. The architectural test is the "geometrically-consistent coordinated lie" row above and the "Coordinated colluders" section: every residual-only mechanism (GNC, DCS, SC) is empirically stuck at err = 1.0 m, while exogenous + Tier 2 rep recovers truth (err = 0.0 m). The control case (exogenous mode without Tier 2 rep) also fails at 1.0 m — confirming the win is the *channel*, not the *mode*.

---

## Reproducibility

```
uv run pytest tests/eval/test_baselines.py -v -s
```

To regenerate this document's measured numbers after a code change:

```
uv run pytest tests/eval/test_baselines.py::test_baseline_comparison_table_exogenous_wins_or_ties \
              tests/eval/test_baselines.py::test_baseline_low_rep_exogenous_strictly_dominates_gnc_only \
              -v -s
```

The PoseGraph optimizer's baseline mode is selected via `pg.set_weight_mode("exogenous" | "gnc" | "dcs" | "switchable")`, with the production default being `"exogenous"`. For `"switchable"`, register switches with `pg.add_switch(factor, prior_strength=γ)` before calling `set_weight_mode`.

---

## Open gaps and what's next

1. ~~**Switchable Constraints (Sünderhauf 2012) integration.**~~ **Closed** (2026-05-17): substrate + assembly fork landed via `SWITCHABLE_CONSTRAINTS_PLAN.md` Waves 0–4. Every published SLAM-layer robust-PGO baseline now has a measured comparison in CI.
1b. ~~**Coordinated-colluder baseline test.**~~ **Closed** (2026-05-17): the "geometrically-consistent coordinated lie" row in the synthesis table is now backed by three tests in `tests/eval/test_baselines.py` — the failure-mode assertion (residual-only modes err = 1.0 m), the recovery assertion (exogenous + Tier 2 rep err = 0.0 m), and the control case (exogenous without rep also fails). The architectural decoupling claim is now empirically gated rather than asserted by argument.
2. **Distributed-GNC over inter-robot factors (Kimera-Multi 2022).** specter-1's pose-graph is currently single-agent in the optimizer; the inter-robot factor exists but inter-agent SLAM is Wave 3+ work per `SLAM_PLAN.md`. The distributed-GNC baseline becomes meaningful once Wave 3 lands.
3. **Real-data comparison.** All baselines here run on synthetic scenarios at σ=0.1m UWB-class noise. Hardware-in-loop on TurtleBot4 + Crazyflie + UWB is funded next-step work and will retest every claim here against real sensor noise.
4. **Moroncelli full-stack comparison.** The token-bucket primitive here approximates the *admission rule* of Moroncelli ANTS 2024 but not its blockchain consensus layer. A full-stack comparison would require running Moroncelli's actual implementation on the same scenarios; that's a multi-week engineering effort that becomes worthwhile once funding lands.
5. **TS parity for `"switchable"` mode.** The TS sim-core `PoseGraphTS` does not currently mirror the switch substrate. Per the SC plan §"explicitly out of scope", this lands alongside the broader TS pose-graph mirror (`SLAM_PLAN.md` Wave 5).
