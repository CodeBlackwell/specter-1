# Switchable Constraints Plan — Closing the Final SLAM-Layer Baseline

**Status: SHIPPED (2026-05-17), EXTENDED (2026-05-18).** Switchable
Constraints landed as the fourth `weight_mode` in
`PoseGraph.set_weight_mode("switchable")` with joint `s_i ∈ [0, 1]`
optimization, the data/prior split per Sünderhauf §3, full analytic
Jacobians, and measured baselines in `tests/eval/test_baselines.py` +
`docs/BASELINES.md`. ADR 0022 §4 then extended the static `γ_i` per-
factor prior strength into a function of the reporter's current
reputation: `γ_i(t) = γ_base · r_now · GAMMA_REP_SCALE + γ_floor`
(GAMMA_REP_SCALE = 10.0, γ_floor = 0.01). The SC closed-form optimum
`s* = γ / (‖r‖² + γ)` means low-rep peers see the prior released and
the switch drops under residual evidence; high-rep peers get the strong
anchor that keeps `s ≈ 1` against noisy residuals. This is the
operationalization of Sünderhauf §4's "external evidence" framing —
specter-1 supplies the external evidence channel (Beta(α,β) reputation
from range-only Tier 1/2 voting). Opt-in via
`enable_reputation_tracking_gamma(True)`; off-by-default preserves the
fixed-γ math/parity contract that this plan locked in.

The plan below remains as the design artifact that produced it.

---

**Goal (original):** add Switchable Constraints (Sünderhauf & Protzel, IROS 2012) as the fourth SLAM-layer weighting mode in `PoseGraph.set_weight_mode(...)`, completing the head-to-head matrix in `docs/BASELINES.md`. After this lands, every published SLAM-layer robust-PGO baseline has a measured comparison against specter-1 on shared scenarios.

**Estimate (original):** 4–5 days end-to-end. Tight-budget path: Waves 0 → 1 → 2 (~3 days) is the minimum viable comparison; Waves 3 + 4 are reviewer polish.

**Status (original):** plan only — no code lands until this is reviewed.

---

## Why this matters

Switchable Constraints is the last published baseline cited in ADR 0016 (`[R3]`) that doesn't have a measured comparison in this repo. Without it, the baseline table in `docs/BASELINES.md` has a load-bearing gap that reviewers will name. With it, the comparison story is complete:

- specter-1 `"exogenous"` — reputation prior × GNC (ADR 0018, default)
- `"gnc"` — pure GNC, Yang 2020 (already shipped)
- `"dcs"` — pure DCS, Agarwal 2013 (already shipped)
- `"switchable"` — **this plan, Sünderhauf 2012**

It also matters for the specter-1 story: SC and exogenous-prior DCS are the two closest alternatives — both apply a per-factor scalar weight, but SC *optimizes* the weight from residuals while specter-1 sources it from a separate evidence channel. The head-to-head measurement is the experimental difference that backs the architectural claim.

---

## Math — the Sünderhauf 2012 formulation

Per [R3] §3 and §4 of ADR 0016: for each switchable factor `i`, introduce a scalar **switch variable** `s_i ∈ [0, 1]`. Define the augmented per-factor cost:

```
C_i(x, s_i) = ψ(s_i)² · ‖r_i(x)‖²_Ω_i  +  γ_i · (1 − s_i)²
```

Where:
- `r_i(x)` is the standard factor residual (e.g., odometry, landmark, loop closure)
- `Ω_i` is the factor's base information matrix (the sensor-noise model)
- `ψ(s) = s` for the linear case (the paper's default; we follow this)
- `γ_i` is the **switch prior strength** — penalizes deviating from the inlier hypothesis `s_i = 1`. Paper recommends `Ξ_ij = 1` and `Σ_s = (1/γ)` with `γ ≈ 1.0`.

In assembly terms, this means each switchable factor contributes **two stacked residual blocks**:
- **Data block:** `r_data = s_i · whiten_Ω(r_i(x))` — the standard whitened residual, scaled by the switch.
- **Prior block:** `r_prior = √γ_i · (1 − s_i)` — pulls the switch toward 1.

The combined Mahalanobis cost is `‖r_data‖² + ‖r_prior‖²`, with information identity on both blocks (the scaling lives inside the residual definition).

**Jacobians (the load-bearing math):**

For state variable `x_j` (pose or landmark slot):
```
∂r_data/∂x_j = s_i · whiten_Ω(∂r_i/∂x_j)
∂r_prior/∂x_j = 0
```

For the switch variable `s_i`:
```
∂r_data/∂s_i = whiten_Ω(r_i(x))    # i.e., the residual itself
∂r_prior/∂s_i = −√γ_i
```

The switch couples the data block to itself (the residual depends on `s_i`) and the prior block (a single −√γ row). No coupling between switches across factors.

**Update step:**
- Pose / landmark variables: existing manifold retraction (exp_se2 for poses, additive for landmarks).
- Switch variables: additive, with clamping to `[0, 1]` after each LM step per Sünderhauf §4 ("Switch Variable Clamping").

**Convergence considerations:**
- Switch initialization: `s_i = 1.0` (inlier hypothesis). Liars converge downward.
- LM damping: the augmented Hessian is still PSD because both blocks have identity information; the switch column adds a single diagonal entry equal to `γ_i + ‖∂r_data/∂s‖²`.
- The paper notes that SC introduces local minima when `γ` is too small (switch collapses too easily) or too large (residual signal can't overcome the prior). Default `γ = 1.0` is the experimentally-validated value for the synthetic benchmarks.

---

## What changes in the codebase

### Files touched

| File | Change | LOC delta |
|---|---|---|
| `src/specter/slam/pose_graph.py` | Switch variable storage, state-vector extension, residual + Jacobian assembly fork, weight_mode dispatch | +~250 |
| `tests/eval/test_baselines.py` | Un-skip `test_baseline_switchable_constraints_recovers_landmark`; add 2–3 switch-trajectory assertions | +~60 |
| `tests/test_pose_graph_switchable.py` | New file: unit tests for switch math (jacobians, clamping, convergence) | +~200 |
| `docs/BASELINES.md` | Update the head-to-head table with measured SC numbers | +~30 |
| `docs/adr/0018-reputation-as-factor-information-prior.md` | Add a "Related work and differentiation" subsection on SC (already cited; this adds the *measured* differentiation) | +~25 |

**No** changes to: TS parity port (SC is SLAM-layer, not in sim-core's purview); trust evaluator; sensor model; sim runner.

### `PoseGraph` substrate changes

1. **Switch storage** — new fields:
   ```python
   self._switches: dict[str, float] = {}        # factor_key → s_i ∈ [0, 1]
   self._switch_priors: dict[str, float] = {}   # factor_key → γ_i
   self._switchable_factor_keys: list[str] = [] # insertion-order list for state packing
   ```

2. **State-vector layout** — `_state_dim()` extends:
   ```python
   def _state_dim(self) -> int:
       return (
           3 * len(self._free_pose_ids())
           + 2 * len(self._landmark_ids)
           + len(self._switchable_factor_keys)   # NEW
       )
   ```
   Switch slots come *after* pose and landmark slots so the existing slot APIs are unaffected. `_switch_slot(factor_key) -> int` returns the offset.

3. **Switch ingestion API** — public:
   ```python
   def add_switch(self, factor: object, prior_strength: float = 1.0) -> None:
       """Register `factor` as switchable. Switch initialized to 1.0 (inlier).
       Only takes effect when weight_mode == 'switchable'."""
   ```
   Existing factors don't need to be re-added — `add_switch` consults `_factor_key(factor)` to attach the switch.

4. **`weight_mode = "switchable"` semantics:**
   - `_weight_of(factor)` returns `s_i² · 1.0` (information scaling — equivalent to `Ω_eff = s² · Ω` per the paper).
   - But this isn't enough — the *residual* and *Jacobian* must also account for the switch and the prior. Hence the assembly fork below.

5. **Residual + Jacobian assembly fork** — the existing `_residual_vector()` and `_jacobian_matrix()` extend with a switch path:
   - For each switchable factor, append the prior residual `√γ · (1 − s)` as an extra row.
   - For each switchable factor, scale the data Jacobian rows by `s` (factor-state derivatives) AND add the `∂r_data/∂s` column.
   - Add the prior row's `−√γ` entry in the switch column.

6. **Update path** — `_apply_delta(δ)` extends:
   ```python
   # existing pose + landmark updates...
   # NEW: switch updates with clamping
   for key in self._switchable_factor_keys:
       slot = self._switch_slot(key)
       self._switches[key] = max(0.0, min(1.0, self._switches[key] + δ[slot]))
   ```

7. **`set_weight_mode("switchable")` validation:**
   - If no factors have switches added, raise a clear error ("call add_switch(factor, γ) before set_weight_mode('switchable')").
   - If `weight_mode != "switchable"`, the switch state is dormant — does not affect `_weight_of`.

### `tests/eval/test_baselines.py` changes

Un-skip `test_baseline_switchable_constraints_recovers_landmark` and replace `raise NotImplementedError` with:

```python
def test_baseline_switchable_constraints_recovers_landmark() -> None:
    """SC (Sünderhauf 2012) jointly optimizes a switch variable per factor.
    The lying landmark factor's switch should converge toward 0 as the
    residual mismatch overwhelms the switch prior; recovery error
    bounded by < 1.0 m."""
    pg, liar = _make_lying_landmark_graph("exogenous")  # exogenous mode constructs the graph
    for factor in pg.landmark_factors():
        pg.add_switch(factor, prior_strength=1.0)
    pg.set_weight_mode("switchable")
    pg.optimize_gnc()
    lm_x = pg.landmarks()["lm0"][0]
    assert abs(lm_x - LANDMARK_TRUTH_X) < 1.0
    # Liar's switch collapses to near zero
    liar_switch = pg.switches()[pg._factor_key(liar)]  # public accessor TBD
    assert liar_switch < 0.3, f"liar switch={liar_switch:.3f}, want < 0.3"
```

Add a fourth baseline column to `test_baseline_comparison_table_exogenous_wins_or_ties` covering switchable mode at rep=0.9.

---

## Waves

### Wave 0 — Math + interface design (0.5 days, no code) ⏳

- [ ] Confirm linear switch function `ψ(s) = s` is the right default (Sünderhauf paper Table II results); commit a one-paragraph design note in ADR 0018 noting we use the linear case and defer the sigmoid variant
- [ ] Lock the switch-update semantics: additive update + clamping to [0, 1] (per paper §4)
- [ ] Decide the public API surface (`add_switch`, `switches()` accessor, validation behavior); write the docstrings before the implementation
- [ ] Decide which factor types are switchable: **all** by default (landmark, odometry, inter-robot, loop closure) — Sünderhauf's paper restricts to loop closures but the math is type-agnostic and we want a fair comparison against the lying-landmark scenario already in our battery

**Exit gate:** the docstrings + ADR note are reviewed; no code yet.

### Wave 1 — Switch state + assembly (1.5 days)

- [ ] Add `_switches`, `_switch_priors`, `_switchable_factor_keys` fields to `PoseGraph.__init__`
- [ ] Implement `add_switch(factor, prior_strength)` with the `_factor_key` lookup
- [ ] Extend `_state_dim()` and add `_switch_slot()`
- [ ] Extend `_pack_state()` / `_unpack_state()` to handle the switch tail
- [ ] Extend `_apply_delta()` to update switches with `[0, 1]` clamping
- [ ] Add `switches()` accessor returning a dict copy for inspection
- [ ] **Unit tests in `tests/test_pose_graph_switchable.py`:**
  - State-dim grows by switch count
  - `add_switch` rejects unknown factors
  - `_apply_delta` clamps switches at boundaries (test δ that would push below 0 or above 1)
  - `switches()` initial values = 1.0

**Exit gate:** the substrate runs without touching optimization. Existing tests pass unchanged.

### Wave 2 — Residual + Jacobian fork (1.5 days)

- [ ] Identify the existing residual-assembly function; add a switchable-factor branch that:
  - Scales the data residual by `s`
  - Appends `√γ · (1 − s)` as a prior residual row
- [ ] Identify the Jacobian-assembly function; add a switchable-factor branch that:
  - Scales the data Jacobian's state columns by `s`
  - Adds the `∂r_data/∂s = whiten_Ω(r(x))` column
  - Adds the `∂r_prior/∂s = −√γ` row entry
- [ ] Wire `weight_mode == "switchable"` to route through the new branches
- [ ] **Unit tests:**
  - Switch = 1 everywhere → results identical to `weight_mode = "gnc"` (the SC formulation reduces to GNC-base at `s = 1` and `γ → ∞`)
  - Switch = 0 on one factor → that factor's data contribution to the cost is zero; only its prior contribution remains
  - Numeric Jacobian (existing `_numeric_jacobian` infrastructure) matches the analytic Jacobian on a 2-factor toy graph to 6 decimals — gates the math correctness

**Exit gate:** numeric vs analytic Jacobian agreement to 6 decimals. This is the most error-prone wave; the Jacobian-match test is the load-bearing correctness check.

### Wave 3 — Baseline-comparison integration (0.5 days)

- [ ] Un-skip `test_baseline_switchable_constraints_recovers_landmark`; assert recovery error < 1.0 m and lying-factor switch < 0.3
- [ ] Add a switchable column to `test_baseline_comparison_table_exogenous_wins_or_ties` (rep_liar=0.9 case)
- [ ] Add a short-horizon test parallel to `test_baseline_low_rep_exogenous_strictly_dominates_gnc_only` for SC — measure how fast SC converges the switch vs. how fast exogenous-prior achieves equivalent suppression
- [ ] Capture printed measured numbers (the `-v -s` output) for `docs/BASELINES.md`

**Exit gate:** all baseline-comparison tests pass; measured numbers are printed and captured for the docs update.

### Wave 4 — Documentation update (0.5 days)

- [ ] Update `docs/BASELINES.md`:
  - Add SC row to the long-horizon table
  - Add SC column to the synthesis table
  - Update the closing synthesis paragraph — the headline becomes "every published baseline has a measured comparison"
- [ ] Update `docs/SYSTEM_ASSESSMENT.md` §8 ("Honest gaps"): remove Switchable Constraints from the deferred list; update §9 recommendation 1 to reflect the closed gap
- [ ] Update `docs/adr/0018-reputation-as-factor-information-prior.md` Related-work section: add the *measured* differentiation paragraph against SC (currently only differentiated against Moroncelli ANTS 2024)
- [ ] Update `THREAT_MODEL.md`: a one-line note acknowledging SC's role as comparison baseline

**Exit gate:** docs link to passing tests; the funder/reviewer pitch reads as "every published baseline measured" rather than "every published baseline measured except one."

---

## Tests at a glance

| Test | Asserts | Why |
|---|---|---|
| Wave 1 substrate tests | state-dim, slot allocation, clamping | gates the storage layer |
| Wave 2 jacobian-vs-numeric | analytic == numeric to 6 decimals | gates the math correctness |
| Wave 2 switch-equals-one == gnc-mode | SC at s=1 reduces to GNC | gates the assembly fork |
| Wave 3 lying-landmark | recovery < 1.0 m, liar switch < 0.3 | the baseline measurement |
| Wave 3 comparison-table | 4 modes side-by-side at rep_liar=0.9 | the headline table for the docs |
| Wave 3 short-horizon | SC convergence speed vs. exogenous-prior | the architectural-decoupling claim |

---

## Risks + mitigations

1. **Switch initialization sensitivity.** Per Sünderhauf §4, switch initial value matters: `s = 1.0` (inlier) is the paper's default but fails for badly-initialized graphs.
   - *Mitigation:* match the paper's default exactly; document that initialization is `1.0`; add a fixture test that catches regressions.
2. **γ tuning.** The prior strength `γ_i` is the single most sensitive hyperparameter. Too small: switch collapses on any noise. Too large: switch never moves.
   - *Mitigation:* use the paper's default `γ = 1.0` for all factors; add a `add_switch(factor, prior_strength=...)` parameter so we can experiment without code changes; document the default + the experimental range tested.
3. **LM damping interaction.** Adding the switch dimension changes the Hessian conditioning. LM's λ schedule was tuned for the existing state vector.
   - *Mitigation:* keep existing λ schedule; the switch column adds well-conditioned entries (the prior contributes `γ_i` directly to the diagonal). If conditioning regressions surface, fall back to dense Cholesky with a higher λ floor.
4. **GNC interaction.** GNC's μ-decay already downweights large residuals. With SC in addition, we'd be running *two* outlier-rejection mechanisms simultaneously. This is intentional (we want a fair head-to-head against SC) but might converge to a different local minimum than SC-alone.
   - *Mitigation:* for the SC baseline, disable GNC by setting `_weight_mode = "switchable"` and skipping `optimize_gnc()` — use plain `optimize()`. Add a dedicated `optimize_switchable()` if a tuned LM loop is needed.
5. **State-vector growth at large N.** A 200-keyframe graph with full-rate landmarks would add hundreds of switch variables. CSC factorization handles it (each switch is a single column with sparse coupling) but the sparse Cholesky symbolic-factorization cache needs to invalidate when switches change classes.
   - *Mitigation:* this is not an issue for the baseline-comparison scenarios (single-pose, 4 factors, N ~10). Document the scaling concern as future work if SC is ever considered for production.

---

## What is explicitly out of scope

- **TS parity for the switchable mode.** SC is SLAM-layer-only; the TS workshop console doesn't currently run the pose-graph optimizer (per `SLAM_PLAN.md` Wave 5 status). Adding TS parity for SC means duplicating ~250 LOC of sparse-linear-algebra-aware switch logic in TypeScript. **Defer** — when the TS pose-graph mirror lands, SC parity comes with it.
- **The dynamic / time-varying switch prior** (Sünderhauf §6). The paper experiments with `γ_i` that varies per iteration; we use a fixed default. Reviewer-friendly but not baseline-load-bearing.
- **The sigmoid switch function** `ψ(s) = sigmoid(s)`. Paper Table II shows the linear variant is competitive; sigmoid is for the convergence-pathology cases that don't apply to the lying-landmark scenario.
- **Switchable inter-robot factors.** specter-1's inter-robot factors exist (`InterRobotFactor`) but the multi-agent optimizer path is `SLAM_PLAN.md` Wave 3+ work. Switches on those factors land alongside multi-agent SLAM, not here.
- **The "ResILT" / "RRR" / "Vertigo" variants** (later Sünderhauf-line papers). Out of scope; SC IROS 2012 is the canonical citation in ADR 0016.

---

## Acceptance criteria (the bar for merging)

1. `uv run pytest -q tests/test_pose_graph_switchable.py` — 100% pass
2. `uv run pytest tests/eval/test_baselines.py -v -s` — no skipped tests; printed measurements captured in `docs/BASELINES.md`
3. `uv run pytest -q` — no regressions on the full 390-test Python suite
4. `just ui-typecheck && just ui-test` — unaffected (TS layer is untouched)
5. `uv run ruff check src tests && uv run mypy src/specter/slam` — clean
6. `docs/BASELINES.md` updated with measured SC numbers in both the long-horizon table and the synthesis table
7. `docs/SYSTEM_ASSESSMENT.md` §8 + §9 updated to reflect the closed gap

When all 7 ✓, the SLAM-layer baseline picture is **complete**: every published alternative cited in ADR 0016 has a measured comparison in CI.

---

## After this lands

`docs/SYSTEM_ASSESSMENT.md` §9 recommendation 1 becomes "done" entirely. The remaining open items are:

- Hardware-in-loop (funded next-step work)
- Distributed-GNC over inter-robot factors (gated on `SLAM_PLAN.md` Wave 3)
- Full-stack Moroncelli comparison (their actual implementation, not the token-bucket primitive)
- TS parity for the SLAM optimizer (gated on the same `SLAM_PLAN.md` Wave 5)

None of those are SLAM-layer weighting comparisons; the weighting story is done.
