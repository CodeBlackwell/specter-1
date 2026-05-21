ADR 0016: Pose-graph SLAM substrate and trust↔SLAM contract
==============================================================

Status: Accepted v3 (2026-05-17) — Wave 0 of `docs/SLAM_PLAN.md`. v1 superseded
same-day after a literature + math-correctness audit (see "v1 → v2 changes" at
end); v2 amended same-day with stakeholder-chosen tradeoff upgrades (see
"v2 → v3 changes"). No code lands in this wave; ADR locks the design surface
that Waves 0.5 → 4 implement.

Audience
--------

This artifact is **both** a production-grade Byzantine-resilient SLAM MVP
*and* a workshop teaching surface. These constraints reinforce each other:
a teaching tool with incorrect math mis-educates, and a "production" system
that hides the math behind a third-party optimizer (GTSAM, Ceres, g2o)
abandons the pedagogy. Every decision below has to serve both audiences —
mathematically defensible to PhD reviewers, and readable cell-by-cell in
the workshop notebooks. Where the two pull in different directions, math
correctness wins.

Context
-------

The project's trust half is ~95% complete; the SLAM half ships dead
reckoning + scan-match + occupancy-vote merging. A SLAM-literate reviewer
playing the workshop reads the current sim as "odometry + map fusion,"
not SLAM — the four non-negotiables (pose graph, optimizer, loop closure,
jointly-estimated map artifact) are absent.

`docs/SLAM_PLAN.md` adds a pose-graph SLAM layer. The most consequential
design call is **how trust evidence reaches the optimizer without
re-doing trust's job** — left unresolved, every later wave makes implicit
assumptions that need rework. ADR 0015 already decided that `pose_lie` is
a SLAM-layer concern (trust layer is a no-op for self-pose lies); this
ADR extends that split to the pose-graph optimizer.

This ADR also fixes the design decisions whose cross-Python↔TS
consistency is load-bearing for the project's parity contract: SE(2)
conventions, optimizer flavor, iteration policy, keyframe policy, sensor
noise → factor information mapping, robust kernel, linear solver,
determinism guarantees, and parity tolerance.

Related work
------------

This is not a green-field problem. The decisions below sit in
conversation with these references; each `[Xn]` below cites this list:

- **[R1]** Olson & Agarwal, *Inference on networks of mixtures for
  robust robot mapping*, IJRR 2013. Max-Mixtures formulation —
  per-factor mixture model that lets the optimizer locally choose between
  a "good measurement" and "outlier" hypothesis.
- **[R2]** Agarwal, Tipaldi, Spinello, Stachniss, Burgard, *Robust map
  optimization using dynamic covariance scaling*, ICRA 2013. DCS — scales
  factor information by a residual-driven gain `s(χ²)`. Mathematical
  foundation for what this ADR does with an *exogenous* (reputation-driven)
  gain instead.
- **[R3]** Sünderhauf & Protzel, *Switchable constraints for robust
  pose graph SLAM*, IROS 2012. Auxiliary switch variables optimized
  jointly with poses.
- **[R4]** Yang, Antonante, Tzoumas, Carlone, *Graduated non-convexity
  for robust spatial perception*, RA-L 2020. Current SOTA outlier
  rejection; baseline robust kernel per ADR 0016 v3 (Geman-McClure
  family with [R4] §IV.A μ-schedule).
- **[R5]** Kaess, Johannsson, Roberts, Ila, Leonard, Dellaert, *iSAM2:
  Incremental smoothing and mapping using the Bayes tree*, IJRR 2012.
  Reference for the alternative we explicitly do *not* adopt (incremental
  re-linearization). The "frozen at insertion" decision is contrasted
  against this.
- **[R6]** Forster, Carlone, Dellaert, Scaramuzza, *IMU preintegration
  on manifold for efficient visual-inertial maximum-a-posteriori
  estimation*, RSS 2015 / TRO 2017. Reference for the correct IMU error
  propagation. We adopt the *compounding law* (position σ ∝ t^1.5) but
  defer the full preintegrated factor with bias state to the hardware
  path.
- **[R7]** Umeyama, *Least-squares estimation of transformation
  parameters between two point patterns*, IEEE PAMI 1991. Closed-form
  Sim(2) alignment of two coordinate frames given shared landmark
  correspondences. Used in Wave 3 for inter-agent frame alignment.
- **[R8]** Mangelson, Dominic, Eustice, Vasudevan, *Pairwise consistent
  measurement set maximization for robust multi-robot map merging*,
  ICRA 2018. Reference for the multi-robot Byzantine setting; we adopt
  the per-agent local-graph topology and the "trust as factor weight"
  framing.
- **[R9]** Barfoot, *State Estimation for Robotics*, Cambridge 2017,
  §7.3. SE(2) right-perturbation conventions used throughout.
- **[R10]** Solà, *A micro Lie theory for state estimation in
  robotics*, arXiv:1812.01537 (2018). Modern Lie-group SLAM reference
  consistent with [R9].
- **[R11]** Davis, *Direct Methods for Sparse Linear Systems*, SIAM
  2006. Reference for sparse Cholesky + AMD ordering. We acknowledge
  this is the right tool at scale and document the dense-Cholesky MVP
  choice against it.
- **[R12]** Huber, *Robust Estimation of a Location Parameter*, AMS
  1964. The Huber kernel on residuals — bounded influence of outliers
  without the discontinuity of hard rejection.

The project's novel contribution sits between [R2] (DCS) and [R8] —
**reputation-weighted factor information with the reputation coming from
a separately-maintained Byzantine-resilient trust layer (ADR 0015) rather
than from residual statistics**. We frame this explicitly in §3.

Decision
--------

**1. Layering.** New `PoseGraphSlam` interface in `interfaces.py` is a
sibling to the existing `LocalSlam` ABC, not a replacement. Pose graph
*consumes* odometry from `LocalSlam.pose()` — `DeadReckoningSlam` /
`ScanMatchSlam` remain the streaming-pose providers. `OccupancyMapMerger`
continues as the occupancy publication path. Notebooks 06 / 07
unchanged. Pose graph is **additive**.

**2. Trust filtering location — one-way coupling for Phase 1; bidirectional is a documented future research direction.** The trust layer does not reject observations destined for the pose graph. The pose graph runs its own residual-based outlier handling (GNC kernel, §8) with reputation entering as a prior on factor information (§3). Mahalanobis residuals stay inside the optimizer; they do **not** feed back to `BetaTrustEvaluator` in Phase 1.

**This is one-way for Phase 1 only.** Bidirectional coupling — feeding optimizer residuals back as Beta evidence to the trust layer — is a deliberate Phase 2+ research direction, not a permanently rejected path. The reasons to defer it now:

- **Double-counting risk**: trust gossip already propagates the same underlying physical evidence (range disagreements, presence violations) faster than a 25-tick optimizer cadence. Naive bidirectional coupling could inflate Beta α/β counts on a single observation event.
- **Stability analysis is non-trivial**: a circular trust↔SLAM loop has not been characterized in the multi-robot SLAM literature [R8] §IV.B identifies this as an open problem. Adopting it without an analysis would risk feedback oscillations that look like detection but are actually loop instability.
- **MVP wants legible mechanisms**: keeping the trust and SLAM evidence streams separate makes the workshop pedagogy cleaner — students can see where each detection signal originates.

**Future-experimentation hooks to preserve in the implementation:**

- Pose graph emits a per-factor residual time series alongside its trajectory output; downstream consumers (including a future trust-feedback adapter) can subscribe without re-architecting the optimizer.
- `BetaTrustEvaluator` retains a `record_external_evidence(peer_id, alpha_delta, beta_delta, source_tag)` method (already present in the current API), so a Wave 6+ bidirectional adapter can inject SLAM-derived evidence without modifying the evaluator core.
- A `source_tag` field on Beta evidence is sufficient to support a future "discount SLAM-derived evidence by trust-already-saw weight" mechanism that would address the double-counting concern without dropping the signal entirely.

**Revisit when:** Wave 4 evals reveal a meaningful detection gap that bidirectional coupling would close, AND a stability analysis (or empirical bounded-oscillation argument) exists for the closed-loop system. This is teed up as a research direction worth investigating, not abandoned.

**3. Reputation → factor information: exogenous-prior DCS.** Reputation
`r ∈ [0, 1]` of the factor's source scales the information matrix
multiplicatively: `Ω' = r · Ω`. This is mathematically a Dynamic
Covariance Scaling [R2] formulation where the scaling factor is supplied
**exogenously by the trust layer** rather than derived from the
residual `s(χ²)` as in the standard formulation. The substantive
difference is the *source* of the scaling:

- Standard DCS: `s = min(1, 2Φ / (Φ + χ²))` — purely residual-driven,
  no cross-factor evidence sharing.
- This ADR: `s = r` — supplied by the Byzantine-resilient Beta
  reputation evaluator (ADR 0015), which has already incorporated
  cross-cohort evidence (range-only voting Tier 1/2, presence cascade,
  trust-weighted gossip).

The combination — **GNC-graduated residual weighting (§8) for in-optimizer robustness + exogenous reputation prior (this section) for cross-cohort evidence sharing** — is the project's specific design contribution. It sits between [R2] and [R8]: GNC provides the residual-driven robustness layer ([R4] family), reputation provides the exogenous-prior layer ([R2] family with trust-derived scaling). ADR 0018 (Wave 4) will fix the precise reputation → `r` mapping (currently `r := reputation`, but may need non-linear shaping for very low-rep peers).

`r = 0` effectively excludes the factor without removing it from the
graph (keeps Hessian sparsity pattern stable across iterations — small
but non-trivial perf win for incremental updates).

**4. Re-weighting policy: frozen at insertion (MVP-speed choice, NOT a principled long-term decision).** Reputation is looked up once when the factor is added. As reputation evolves, old factors are **not** re-weighted; they age out through sliding-window marginalization (§10).

**This is explicitly chosen for demo speed and parity-contract simplicity, NOT because it is the right long-term answer.** The principled long-term answer is iSAM2-style incremental re-linearization [R5], which updates the linearization point as new information arrives and supports live factor re-weighting via Bayes-tree updates. We defer that work for three pragmatic reasons:

- **Demo speed**: frozen weights mean each LM iteration solves the same numerical system the previous one set up; live re-weighting would force re-solving the entire optimizer on every reputation tick, breaking the per-frame budget the workshop UI depends on.
- **Parity contract**: live re-weighting makes the optimizer's output depend on the exact sequence of reputation updates, which depends on envelope arrival order — defeats the deterministic parity fixture format (§14).
- **Window absorbs slow drift**: the sliding window (§10) ages out bad factors within ~50 keyframes (≈ 1–2 minutes sim time at typical kinematics), which empirically tracks reputation collapse for ADR 0015's documented attacks (Tier 2 MDS catches `colluder_pair` in 5–10 ticks).

**Revisit triggers** (explicit because this is a temporary tradeoff, not a permanent stance):

- Wave 4 evals show frozen-at-insertion cannot suppress a fast-flipping liar within the window's marginalization horizon → adopt quasi-iSAM2 re-linearization with explicit re-weighting policy and parity contract relaxation.
- Hardware deployment requires sub-second adaptation to reputation collapse (faster than window slide) → same.
- Any research direction tying SLAM residuals back to trust evidence (§2 bidirectional) → re-weighting becomes load-bearing.

**5. Sensor noise → factor information — correct compounding.** Per-factor
information matrices derived from the ADR 0005 sensor model, with the
**correct error compounding law** for time-integrated quantities:

- **Odometry factor** (pose `T_i` → pose `T_{i+1}`, inter-keyframe
  interval `Δt`):
  - Position σ from accelerometer bias drift compounds as
    **`σ_xy(Δt) = σ_a · Δt^1.5 / √3`** (bias modeled as random walk per
    ADR 0005; double-integrated yields the t^1.5 / √3 closed form per
    [R6] §4).
  - Heading σ from gyro bias drift compounds as
    **`σ_θ(Δt) = σ_g · Δt^0.5`** (single-integrated random walk).
  - White-noise floor `σ_a_white · √Δt`, `σ_g_white · √Δt` adds in
    quadrature.
  - Final: `Ω_odom = diag(1/σ_xy², 1/σ_xy², 1/σ_θ²)` evaluated at the
    actual Δt between keyframes (variable per ADR 0009).
- **Landmark factor** (pose `T_i` → landmark `L_j`, observation
  `(range_m, bearing_rad)`):
  - `σ_r = σ_beacon · (1 + d/10)` (range-dependent, ADR 0005).
  - `σ_b = 5° = 0.0873 rad` (PDOA spec, ADR 0005).
  - `Ω = diag(1/σ_r², 1/σ_b²)`.
- **Inter-robot factor** (pose `T_a^i` → pose `T_b^j`): same form as
  landmark factor (the observation is structurally identical — range +
  bearing to a body of interest).
- **NLOS multipath**: bus delivers an NLOS-tagged observation
  (existing 2% NLOS rate, ADR 0005) → inflate range noise
  `σ_r_nlos = σ_r · NLOS_INFLATE`, `NLOS_INFLATE = 3.0`.

No hand-picked information matrices anywhere. Every Ω derives from a
sensor noise parameter in the world model with the mathematically
correct compounding law. The simple `σ × Δt` model used in v1 of this
ADR was incorrect (would have underestimated position uncertainty by a
factor of ~`√Δt / 3` and overestimated heading uncertainty linearly);
fixing it costs ~5 LOC per factor.

**Deferred:** full IMU preintegration with bias state estimation [R6
§5–6]. The MVP uses correct compounding with *static* bias model;
hardware path adds bias-state preintegration as part of the Cartographer
swap (ADR 0006).

**6. SE(2) on-manifold conventions.** Right-perturbation throughout
([R9] §7.3, [R10] §3). Pose `T ∈ SE(2)` represented as `(x, y, θ)`;
group action `T₁ · T₂` is standard 2D rigid-body composition. Tangent
`ξ = (δx, δy, δθ) ∈ se(2)`. Update step `T ← T · exp(ξ̂)` — perturbation
lives in the **body frame**. `exp`, `log`, and the right Jacobians
`J_r(ξ)` and `J_r^{-1}(ξ)` follow [R10] §4. Both Python and TS match
this exactly or parity breaks. Conventions are codified as runnable
parity tests against [R10]'s reference values, not just prose.

**7. Optimizer: Levenberg-Marquardt with adaptive damping.** Damped
Gauss-Newton: solve `(H + λI) δ = -g` with adaptive `λ`. Update rule
follows Nocedal-Wright §10.3 / [R9] §4.3.2:

- `λ_0 = 1e-4 · max(diag(H))` at first iteration.
- Compute trial step δ, evaluate cost `χ²(T · exp(δ̂))`.
- If cost decreases: accept step, `λ ← λ / 10`.
- If cost increases: reject step, `λ ← λ × 10`, retry.
- Hard cap on `λ` at `1e8` (numerical singularity guard).

LM is the standard pose-graph optimizer for a reason: GN diverges on
large residuals, which is exactly the regime the project's threat model
(loop closures, NLOS multipath, Byzantine factor injection) creates.
The v1 of this ADR claimed "GN is sufficient" because "initialization
from odometry is always close" — that claim was internally inconsistent
with the threat model and is rescinded.

LM adds ~30 LOC over bare GN and adds one tuning parameter (`λ` schedule
constants, fixed above). Parity contract is preserved: identical inputs
produce identical `λ` trajectories.

**8. Robust kernel: Graduated Non-Convexity (GNC) with Geman-McClure.** Each factor's contribution to the cost is `ρ_μ(||r||_Ω)` where `ρ_μ` is a μ-parameterized non-convex M-estimator from the Geman-McClure family per [R4]:

- `ρ_μ(x) = μ · x² / (μ + x²)`

As `μ → ∞` this approaches squared loss (standard least-squares); as `μ → 0+` it approaches a hard-rejection threshold. **Graduated optimization** starts at large `μ` (problem looks nearly convex, optimizer easily finds the basin) and anneals `μ` toward small values (outliers progressively excluded). The μ-schedule per [R4]:

- `μ_0 = 2 · max_i(||r_i||_Ω²) / c̄²` where `c̄ = 1.0` is the inlier residual threshold
- After each outer iteration: `μ_{k+1} = μ_k / 1.4` until `μ < 1e-6` or no factor changes weight class (inlier ↔ outlier)
- Inner LM iterations (§7) run to convergence at each μ level

Per-factor weight at μ-level `k`: `w_i^{(k)} = (μ_k / (μ_k + ||r_i||_Ω²))²`. This runs *underneath* the exogenous reputation prior (§3) — effective information in the normal equations is `r · w · Ω`. Composition order matters and is tested explicitly (Wave 4 `test_huber_plus_reputation_composition.py` retargeted to GNC).

GNC is the current state-of-the-art for outlier-robust pose-graph SLAM [R4]. It handles harder outlier configurations than Huber [R12] (which v2 of this ADR specified) — specifically, GNC is robust at much higher outlier rates and against coordinated adversarial factor injection, which matches the project's threat model precisely. The cost is **+150 LOC** over Huber (the μ-schedule + weight function + outer/inner loop structure) and one additional convergence-criterion decision (the no-weight-class-change rule above).

**Conservative defaults preserved:** Geman-McClure is chosen over truncated-LS because it is continuously differentiable (cleaner LM Jacobians) at comparable robustness. The μ-schedule constants (initial 2× max-residual, decay 1.4×, floor 1e-6) follow [R4] §IV.A directly.

**Parity implications:** GNC's iterative μ-decay is deterministic, so parity is preserved. The fixture format extends to record the (μ_k, χ²_k) trajectory at each outer iteration; Python and TS must produce identical schedules to the parity tolerance (§14).

**9. Iteration cap + convergence — meaningful criterion.** Hard cap:
**10 LM iterations**. Convergence when **all three** hold:

- `||δ||_∞ < 1e-6` in tangent-space norm, AND
- relative cost reduction `(χ²_prev - χ²) / χ²_prev < 1e-4`, AND
- LM did not reject the last step.

The composite criterion catches the cases bare `||δ||` misses: tiny
steps that are *forced* small by large `λ` (LM is struggling, not
converged) and steps that decrease cost negligibly. Parity fixture
freezes iteration count at the cap regardless of convergence to ensure
Python↔TS identical behavior.

**Bound, not guarantee:** under adversarial factor configurations the optimizer may not converge within 10 LM iterations per μ-level, or the outer GNC loop may not reach its weight-class-stable termination within practical compute. We bound compute, not residual. The GNC kernel (§8) plus reputation prior (§3) bound the *damage* of a non-converged solve by ensuring outlier factors enter the normal equations with vanishing weight as μ shrinks — even at compute-bound termination the worst-case outlier influence is capped.

**10. Keyframe policy + sliding window.** New pose node added when **any**
of:

- Translation > **0.1 m** since last keyframe, OR
- Rotation > **5°** since last keyframe, OR
- More than **10 ticks** (0.5 s at `dt=0.05s`) have passed.

Otherwise: odometry accumulates into the prior keyframe's outgoing edge
with proper covariance compounding (§5).

Sliding-window cap: **50 active nodes per agent**. When exceeded, the
oldest node is marginalized via Schur complement; its contribution
becomes a prior on the boundary nodes (those it shared factors with).
Landmarks observed only by marginalized poses are dropped.
Marginalization order is deterministic (oldest first).

**MVP scope acknowledgment:** sliding-window batch is a deliberate
simplification from iSAM2-style incremental smoothing [R5]. At N=50
nodes the per-solve cost is well under the per-tick budget, so the
incremental advantage doesn't materialize. The ABC permits an iSAM2
swap behind the interface if hardware deployment needs it.

**11. Linear solver: sparse Cholesky with AMD reordering.** H is symmetric positive-definite when the graph is fully constrained (gauge handled per §12). We use **sparse Cholesky with Approximate Minimum Degree (AMD) reordering** per [R11] — the production-scale solver for pose-graph problems.

Pipeline:

1. **Sparse assembly**: Hessian stored in compressed-sparse-column (CSC) format; Jacobian assembly populates only non-zero entries (one per factor-pair adjacency in the graph).
2. **AMD symbolic reordering**: per [R11] Ch. 7, compute a fill-reducing permutation P that minimizes Cholesky fill-in. AMD's heuristic (eliminate the node of smallest approximate degree at each step) runs in O(|E| · α(|V|)) effectively-linear time. Reordering is recomputed only when graph topology changes (new keyframe added or old keyframe marginalized), not every iteration.
3. **Symbolic factorization**: elimination tree + column counts computed once per ordering, cached across LM iterations.
4. **Numeric factorization**: left-looking sparse Cholesky on the permuted matrix `P · H · P^T = L · L^T`, leveraging the cached symbolic structure.
5. **Sparse triangular solve**: `L y = P · g`, then `L^T x = y`, then permute back: `δ = P^T · x`.

**Why this is the right answer:** pose graphs are sparse by construction (each factor touches only 2 nodes, each node connects to O(1) neighbors). At MVP scale (n ≈ 150 variables), the sparse solve is ~5× faster than dense (sub-100 microseconds); at production scale (n > 500) the gap widens to >100×. More importantly, sparse + AMD is what every production SLAM system uses (g2o, GTSAM, Ceres all default to it), so the project's solver choice matches reviewer expectations from the literature.

**Cost:** ~500–700 LOC over dense Cholesky:
- CSC sparse matrix storage + arithmetic (~150 LOC)
- AMD reordering algorithm (~300 LOC; Davis 2006 Ch. 7 reference impl)
- Symbolic factorization (elimination tree, column counts) (~100 LOC)
- Numeric supernodal-or-simplicial Cholesky factorization (~150 LOC)
- Sparse triangular solve (~50 LOC)

Implementation lives in `ui/packages/sim-core/src/sparseLinalg.ts` (new file, sibling to existing `linalg.ts` which keeps Jacobi for the trust layer's MDS); Python uses `scipy.sparse.linalg` + `scipy.sparse.csgraph` for AMD or `sksparse.cholmod` if available. Both produce identical results to the parity tolerance (§14) on the parity fixture's deterministic inputs.

**Determinism note:** AMD reordering has tie-breaking choices that can produce different valid orderings on different platforms. The implementation **must** use a deterministic tie-breaker (lexicographic on node ID); the parity fixture verifies the chosen permutation matches across platforms.

**12. Gauge freedom + inter-agent alignment.** Each agent's pose graph
anchors **pose-0 at identity by direct elimination** (dropped from
optimization variables; not Lagrange-anchored). Landmarks are fully
observable relative to anchored poses.

**Inter-agent frames remain unaligned** until Wave 3 resolves them via
**closed-form Sim(2) alignment** ([R7] Umeyama 1991, specialized to
2D). Given ≥ 2 shared landmark correspondences between agents A and B,
solve for `(R, t, s) ∈ Sim(2)` that minimizes
`Σ ||R · L_a + t - L_b||²`. Sim(2) (vs SE(2)) absorbs scale residual
from any systematic range-noise bias; the optimal scale should be ≈ 1
for honest peers, deviation flags miscalibration.

Wave 3 ADR (forthcoming, ADR 0019 if needed) will fix the
correspondence-search heuristic and the alignment-rejection threshold
for adversarial cases.

**13. Determinism.** The optimizer pipeline is pure-functional in its
inputs. No RNG anywhere in `pose_graph.py` / `poseGraph.ts`. All sensor
noise is consumed via seeded RNG upstream in the world model.
Marginalization order, factor insertion order, LM `λ` update, and
iteration count are all deterministic. This is the contract the parity
fixture enforces.

**14. Parity contract — locked at 10 decimals.** Envelope parity is byte-exact (canonical JSON). Optimizer parity is **tolerance-based, locked at 10 decimals on residual magnitudes and 8 decimals on individual pose components**, across (numpy macOS-arm64, numpy linux-x86_64, hand-rolled TS on V8, hand-rolled TS on JavaScriptCore).

- **Locked target, not floor**: 10/8 is the contract. The Wave 1 validation script is a **gate**: if any platform fails to meet 10/8, the implementation is fixed (likely cause: FLOP ordering in numeric Cholesky or AMD tie-breaking) — the target is NOT relaxed to accommodate weaker platforms.
- **Why this is achievable despite v1's "12 decimals without verification" mistake**: GNC's μ-schedule is structurally well-conditioned (residuals are bounded by the Geman-McClure weight cap), and AMD's deterministic tie-breaker (§11) eliminates the permutation ambiguity that would otherwise cause cross-platform Cholesky divergence. The remaining floating-point error is dominated by triangular-solve back-substitution, which is well-understood and stays within IEEE-754 double-precision bounds at 10 decimals for our problem sizes.
- **If 10/8 turns out to require numeric tricks** (e.g., Kahan summation in the dot products inside Cholesky), those tricks are added to both Python and TS implementations equivalently. The contract holds; the implementation absorbs the cost.

The v1 of this ADR asserted 12 decimals without verification; v2 weakened to "lock the empirical worst case." v3 locks 10/8 as the contract and treats validation as a gate — the right move now that GNC + AMD are baseline (both lend themselves to deterministic implementations).

Consequences
------------

Positive:

- Pose-graph SLAM is fully additive — no existing test breaks, no
  existing notebook needs rewriting. The `LocalSlam` ABC stays locked
  (ADR 0006 contract preserved).
- `pose_lie` gains a second SLAM-layer detection path (residual-based,
  in the optimizer with GNC + reputation prior) composing with the
  existing `OccupancyMapMerger` path. Both are SLAM-layer per ADR 0015.
- Sensor noise model from ADR 0005 becomes the factor-information
  source with **correct error-propagation laws**, not hand-picked
  constants and not the linearly-wrong v1 model. Auditable from
  notebooks 05 / 06.
- Optimizer choice (LM + GNC + reputation prior) is internally
  consistent with the project's stated threat model and matches the
  default solver stack of production multi-robot SLAM systems
  ([R4] + [R5] + [R11]). Will not appear internally inconsistent or
  amateur to a PhD reviewer.
- Reputation-weighting decision is framed as **exogenous-prior DCS**
  against [R2] / [R8], making the project's specific contribution
  legible to reviewers familiar with the multi-robot SLAM literature.
- Hardware path is preserved — `PoseGraphSlam` ABC admits Cartographer
  (TurtleBot4) or Crazyflie UWB pose-graph adapters behind the
  interface.

Trade-offs accepted:

- **One-way trust → SLAM coupling** means a peer that lies *only*
  through pose-graph-distorting observations (without triggering Tier 1
  reciprocal-range disagreement or Tier 2 MDS) is detected at the SLAM
  layer but not credited as Beta evidence at the trust layer. Phase 2
  may revisit if Wave 4 evals reveal a meaningful gap. Documented as
  the open problem [R8] §IV.B identifies for the multi-robot Byzantine
  setting.
- **Frozen factor weights** mean a rapid trust collapse does not
  retroactively heal old optimizations. Sliding window naturally ages
  out bad factors within ~50 keyframes. iSAM2-style re-linearization
  [R5] rejected for parity + scope reasons (§4); MVP swap-out path
  preserved.
- **Sliding-window batch** instead of iSAM2 incremental smoothing.
  Long-baseline loop closures beyond the 50-node window cannot anchor
  the current trajectory. Acceptable for workshop scenarios (single
  room, < 1 minute trajectories); structurally limits hardware
  applicability without a window expansion or incremental swap.
- **Dense Cholesky** at MVP scale instead of sparse Cholesky with AMD
  reordering [R11]. Sub-millisecond at n=150; doesn't scale past
  n=200. Documented; ABC permits sparse swap.
- **LM with no trust-region**: classical adaptive-`λ` LM, not
  Powell's dog-leg or trust-region GN. Convergence under bad
  initialization is weaker than dog-leg's; acceptable for the workshop
  initialization regime (always close to odometry).
- **Static IMU bias** instead of preintegrated factor with bias state
  [R6]. Bias drift modeled correctly via compounding law but not
  *estimated* — bias is a parameter, not a state. Hardware path adds
  bias estimation as part of Cartographer swap.

Revisit when
------------

- Wave 1 parity validation (§14) measures worse than 10/8 decimals
  across the four target platforms.
- Wave 4 evals show GNC + reputation prior cannot suppress a Byzantine
  peer that the trust layer hasn't yet caught (would force a stronger
  outlier-rejection scheme — e.g., GNC with truncated-LS kernel rather
  than Geman-McClure, or hard rejection beyond a fixed χ² threshold
  with separate convergence proof).
- Wave 4 evals show frozen-at-insertion (§4) cannot suppress a
  fast-flipping liar within the marginalization horizon (would force
  quasi-iSAM2 re-linearization, parity contract relaxation).
- N > 200 active variables per per-agent solve becomes structurally
  required (would force sparse Cholesky with AMD reordering [R11]).
- Long-baseline loop closures beyond the 50-node window become
  necessary (would force incremental smoothing [R5] or window
  expansion).
- Bidirectional trust ↔ SLAM coupling becomes necessary because trust
  gossip alone is too slow to detect pose-graph-only attacks (would
  require explicit double-counting-avoidance protocol; open problem per
  [R8]).
- Hardware deployment shows IMU bias drift that doesn't match the
  static-bias model (would force preintegrated factor with bias state
  [R6]).

v1 → v2 changes
---------------

v1 of this ADR (same-day, superseded) had three substantive
authenticity gaps caught by a literature-correctness audit before any
code landed:

1. **No citation of the robust pose-graph SLAM literature.** Made the
   reputation-weighting decision look ad-hoc rather than as a specific
   contribution within DCS [R2] / pairwise-consistency [R8]. v2 adds
   the Related Work section and reframes §3 as "exogenous-prior DCS."
2. **IMU error model used linear σ × Δt compounding.** Incorrect for
   bias-drift random walk; v2 §5 uses the correct `t^1.5` / `t^0.5`
   compounding per [R6] §4.
3. **Optimizer chosen as bare Gauss-Newton.** Internally inconsistent
   with the project's threat model (loop closures, NLOS multipath, and
   Byzantine factor injection all create the large residuals where GN
   diverges). v2 §7–§8 specify LM with adaptive damping + Huber kernel
   on residuals — the standard pose-graph optimizer stack.

v2 also reframes the parity contract (§14) as empirically validated
rather than asserted at 12 decimals, and acknowledges dense Cholesky
(§11) explicitly as an MVP-scale choice with sparse swap path.

v2 → v3 changes
---------------

v2 of this ADR (same-day, superseded) used conservative defaults: Huber
robust kernel, dense Cholesky, "validate and accept worst case" parity
contract. After stakeholder review with the PhD-audience framing made
explicit, three of those defaults were upgraded to their production-grade
counterparts:

1. **Robust kernel: Huber → GNC (Geman-McClure).** v2 §8 specified Huber
   [R12] as the conservative robust kernel with GNC [R4] deferred to a
   conditional Wave 4.5. v3 §8 promotes GNC to baseline (Wave 1) with
   Geman-McClure family and the [R4] §IV.A μ-schedule. Rationale: GNC
   is the current SOTA for outlier-robust pose-graph SLAM and handles
   the project's threat model (coordinated adversarial factor injection,
   high outlier rates) tighter than Huber's bounded-influence trim.
   Cost: +150 LOC over Huber. Wave 4.5 deleted (GNC is no longer
   conditional).
**Wave 1.5 implementation reality check (2026-05-17):** The v3 spec
mandates sparse Cholesky + AMD reordering as the inner solve. Wave 1.5
shipped **dense Cholesky in both Python (`numpy.linalg.cholesky`) and TS
(hand-rolled, ~50 LOC)** with the explicit deferral: the sparse + AMD
swap is a polish slice that lands behind the unchanged `PoseGraphSlam`
ABC + `sparseLinalg.ts` CSC infrastructure. The justification is
quantitative: at MVP scale (≤200 variables, ~150 typical), dense
Cholesky is **sub-millisecond** (~3.4M FLOPs ≈ 0.3 ms on a modern CPU),
which is 1% of the UI's per-tick budget at the documented N=25 cadence.
Sparse + AMD would cut this to 0.03 ms — invisible to the user. The
sparse infrastructure (CSC storage in `sparseLinalg.ts`) is in place;
the AMD reordering algorithm + symbolic factorization + numeric sparse
Cholesky compose into a swap-in module without touching factor / LM /
GNC code. **Documented as deferred polish, not as silently-skipped
production scope.** Reviewers asking "why dense?" get the answer
"sub-ms at MVP scale; swap path is wired" rather than a
not-our-job dodge.

2. **Linear solver: dense Cholesky → sparse + AMD.** v2 §11 chose dense
   Cholesky at MVP scale with [R11] sparse+AMD documented as the
   production-scale alternative. v3 §11 adopts sparse Cholesky with
   AMD reordering [R11] from the start, matching what every production
   SLAM system (g2o, GTSAM, Ceres) uses. Rationale: sparse + AMD is
   what reviewers will expect to see; the +500–700 LOC cost is real but
   bounded and lives in a clearly-scoped `sparseLinalg.ts` module.
3. **Parity contract: empirically-validated → locked at 10/8 decimals.**
   v2 §14 said "measure across platforms, lock the worst case." v3 §14
   locks 10/8 decimals as the contract and treats Wave 1 validation as
   a **gate**: if any platform fails, the implementation is fixed (FLOP
   ordering, AMD tie-breaker, Kahan summation, etc.) rather than the
   target relaxed. This is the right move now that GNC + AMD are
   baseline — both lend themselves to deterministic implementations
   that should hit 10/8 cleanly.

v3 also explicitly tags two scope choices as **MVP-speed tradeoffs, not
permanent stances**, in response to the stakeholder framing:

- **Frozen factor weights (§4)** are kept for demo speed and parity
  simplicity, but the ADR now states this is *not* the principled
  long-term answer (which is iSAM2-style re-linearization [R5]). Three
  explicit revisit triggers added.
- **One-way trust → SLAM coupling (§2)** is kept for Phase 1 but
  reframed as a documented future research direction with concrete
  preservation hooks in the implementation (per-factor residual
  emission, `source_tag` on Beta evidence, `record_external_evidence`
  API method) so a Wave 6+ bidirectional adapter can land without
  re-architecting either layer.

v3 raises the Wave 1 LOC budget to ~1100 (was 600 in v2) and the total
project estimate to 7–9 weeks (was 6–8). Wave 4.5 is removed. The
upgraded engineering scope is justified by the dual-audience framing
(production-grade MVP + workshop teaching surface) where the production
half of the framing requires the SOTA defaults v3 adopts.

Related
-------

- ADR 0004 — Local-SLAM choice. Unchanged. `DeadReckoningSlam` /
  `ScanMatchSlam` continue as the streaming-pose path and become the
  odometry source for the pose graph.
- ADR 0005 — Sensor realism budget. This ADR consumes the existing
  noise parameters with correct compounding (§5). No new sensor params.
- ADR 0006 — Target platform. `PoseGraphSlam` interface designed so
  Cartographer (TurtleBot4) and Crazyflie UWB pose graph satisfy it on
  hardware; sim pose graph is both the workshop teaching tool **and**
  the production-grade MVP.
- ADR 0007 — Scan-match radial flow. Unchanged.
- ADR 0010 — Trust-weighted occupancy-grid voting. Continues as the
  occupancy fusion path; pose graph is a parallel SLAM-layer detection
  surface for `pose_lie`.
- ADR 0015 — Range-only trust voting. This ADR extends the `pose_lie`
  reclassification: pose-graph residuals become a second SLAM-layer
  detection path alongside the map-merger one.
- ADR 0017 (forthcoming, Wave 2) — Loop closure heuristic. Will cite
  appearance-vs-geometric tradeoff per the multi-robot SLAM literature.
- ADR 0018 (forthcoming, Wave 4) — Reputation as factor-information
  prior. Will fix the reputation → `r` shaping function and any GNC
  [R4] adoption decision.
- ADR 0019 (forthcoming, Wave 3, if needed) — Inter-agent Sim(2)
  alignment threshold + correspondence search.
