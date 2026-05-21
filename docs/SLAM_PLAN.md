# SLAM Plan — Bringing True SLAM into the Workshop UI

**Goal:** real factor graph + optimizer at the center of the sim; trust gates which factors enter each agent's optimizer (ADR 0015 split). Both a **production-grade Byzantine-resilient SLAM MVP** and a **workshop teaching surface** — constraints reinforce each other (correct math IS the pedagogy; auditable code IS the production-grade demonstration).

**Estimate:** 7–9 weeks (revised after ADR 0016 v3 stakeholder upgrade: Huber → GNC, dense Cholesky → sparse + AMD, locked 10/8 parity). Tight-budget path: Waves 0 → 0.5 → 1 → 2 (~3.5 weeks) for single-agent SLAM. Waves 3 + 4 land the Byzantine thesis.

## Status snapshot — 2026-05-17

**Shipped (commit cf50266 + subsequent):**
- Waves 0 → 5 substrate + workshop scaffolds
- Polishes A (analytic right Jacobian), B (sparse Cholesky on CSC), C (Umeyama Sim(2) + closure detection + L09 demo)
- Analytic Jacobians swapped into LM (Solà §10.1; sign-error in SE(2) adjoint caught by validation test before shipping)
- Cross-platform parity tightened to 10/8 decimals (measured Δ = 1e-36 pose / 1e-58 cost on the LM 4-pose chain)
- ADR 0018 un-freezing path (`set_reputation_source` callable for live rep lookup)
- ADR 0020 bidirectional trust↔SLAM coupling (`slam_residual_evidence` χ² channel)
- TS port: `PoseGraphTS.setReputationSource` + `slamResidualEvidence` + `runCooperativeSlamDemo` (5-cycle GNC-driven outlier separation)
- Workshop UI: L09 `SlamCanvas`, L10/L11 `CooperativeSlamCanvas`, L12 `ClosedLoopSlamCanvas` with bidirectional toggle + reputation trace sparkline
- L09 / L11 / L12 briefings rewritten to teach the closed-loop story end-to-end
- Docker recipe for Phase 1 EXIT (`just battery-docker`)

**Deferred with rationale:**
- AMD reordering + true sparse arithmetic — invisible at MVP scale (~150 vars, dense workspace inside `cscCholesky` = 0.3 ms). Substrate (`sparseLinalg.ts cscCholesky`) in place; AMD swaps in when fill-in becomes measurable.
- Full ROS2 hardware bring-up (Phase 3) — needs TurtleBot4 + Crazyflie+UWB physical hardware.
- Phase 1 EXIT multi-process battery run — Docker recipe shipped, awaits user invocation.

---

## Guardrails

- [ ] No GTSAM / g2o / Ceres — hand-rolled SE(2). Hides the math from the teaching surface AND from the audit surface.
- [ ] **Math must be defensible to PhD reviewers**. Cite the literature (Olson 2013, Agarwal 2013, Forster 2015, Kaess 2012, Umeyama 1991, Barfoot, Solà) where decisions sit in conversation with it. No silent simplifications.
- [ ] **Math and threat model must be internally consistent**. Optimizer must handle the residual regime the project's own attacks create (LM + GNC + sparse Cholesky, not bare GN with dense solver).
- [ ] Parity contract: tolerance-based, **locked at 10/8 decimals** across (numpy macOS-arm64, numpy linux-x86_64, TS V8, TS JavaScriptCore). Wave 1 validation script is a **gate** — if any platform fails 10/8, the implementation is fixed (FLOP ordering, AMD tie-breaker, Kahan summation), the target is NOT relaxed.
- [ ] Determinism: no RANSAC, no random keyframe sampling, no stochastic init (seeded RNG only if needed later)
- [ ] No 3D SE(3), full preintegrated IMU factor with bias state, ICP, ORB, appearance-based loop closure, decentralized consensus (all deferred to hardware path)
- [ ] ABCs in `interfaces.py` (`LocalSlam`, `MapMerger`) preserved — hardware-swap contract per ADR 0006
- [ ] `DeadReckoningSlam` / `ScanMatchSlam` / `OccupancyMapMerger` not deprecated — pose graph is additive, sits above them
- [ ] One ADR per wave (0016, 0017, 0018; 0019 + 4.5 as needed), no shortcuts
- [ ] Every wave ends: `uv run pytest -q` green, `just ui-test` green, `just ui-typecheck` clean, `PROGRESS.md` updated

---

## The four non-negotiables (visible by Wave 5)

- [ ] Pose graph (SE(2) nodes, constraint edges)
- [ ] Optimizer (Gauss-Newton on linearized system)
- [ ] Loop closure (distinguishes SLAM from dead reckoning)
- [ ] Map artifact (landmarks, jointly estimated with poses)

---

## Wave 0 — ADR 0016 v3: trust↔SLAM contract (3 days, no code) ✅

- [x] Confirm ADR 0015 stance: trust layer does not reject pose-graph observations; pose graph runs residual-based outlier detection weighted by reputation prior
- [x] One-way coupling (trust → SLAM) for Phase 1; **bidirectional documented as future research direction with concrete preservation hooks** (`record_external_evidence`, `source_tag`, per-factor residual emission) per ADR 0016 §2
- [x] Re-weighting policy: factors **frozen at insertion** — explicitly tagged as MVP-speed tradeoff (NOT a principled long-term decision); three revisit triggers documented; iSAM2 [R5] is the principled answer if/when triggered (§4). **Superseded by ADRs 0020 §5 + 0022 §§2-4**: un-frozen rep per LM step + SC switch prior `γ_i(t)` + singleton cap + fade close the practical retroactive-re-weighting gap without paying iSAM2's complexity cost. iSAM2 retained as the "expensive escape valve" per ADR 0022 §Revisit-when, no longer load-bearing.
- [x] Specify sensor-noise → factor-information mapping with **correct compounding** (`σ_xy ∝ t^1.5 / √3`, `σ_θ ∝ t^0.5` per [R6]) → §5
- [x] Lock SE(2) on-manifold conventions: right-perturbation, exp/log map, retraction per [R9] §7.3 + [R10] §3–4 — parity-tested against [R10] reference values → (§6)
- [x] Optimizer: **Levenberg-Marquardt with adaptive damping**, NOT bare Gauss-Newton (LM is internally consistent with the threat model's large-residual regime) → (§7)
- [x] Robust kernel: **GNC with Geman-McClure** per [R4] (μ-schedule: `μ_0 = 2 · max_i(||r_i||²) / c̄²`, decay 1.4×, floor 1e-6); promoted to baseline from v2's Huber-conservative choice → (§8)
- [x] Iteration cap = 10 LM iterations per μ-level; composite convergence criterion (`||δ||_∞` AND relative cost reduction AND last step accepted); outer GNC iteration terminates when no factor changes weight class → (§9)
- [x] Keyframe policy → 0.1 m / 5° / 10 ticks; 50-node sliding window with Schur marginalization (MVP scope; iSAM2 [R5] swap path documented) → (§10)
- [x] Linear solver: **sparse Cholesky with AMD reordering** per [R11] (CSC storage, deterministic tie-breaker, cached symbolic factorization) — adopted from start, not deferred; matches g2o/GTSAM/Ceres default solver → (§11)
- [x] Gauge: per-agent pose-0 fixed by direct elimination; inter-agent alignment via **Umeyama 1991 closed-form Sim(2)** [R7] (Wave 3) → (§12)
- [x] Reframe reputation-weighting as **exogenous-prior DCS** (extension of [R2] with reputation as the scaling source rather than residual) — project's specific contribution legible to reviewers → (§3)
- [x] Parity contract: **locked at 10/8 decimals** across (numpy macOS-arm64, numpy linux-x86_64, TS V8, TS JavaScriptCore); Wave 1 validation script is a **gate** (fix implementation, not relax target) → (§14)
- [x] Write ADR 0016 v3 with Related Work section citing R1–R12
- [x] Document v1 → v2 → v3 changes (v2: three authenticity gaps from literature audit; v3: three stakeholder-driven upgrades to production-grade defaults)
- [x] Update `THREAT_MODEL.md`: forward-looking note for second SLAM-layer detection path (pose-graph residuals composing with `OccupancyMapMerger`); table row unchanged until Wave 4 measurement

## Status: ✅ Substrate landed (Waves 0 → 4 production-grade math + ADRs); Wave 5 scaffolds in UI rail with full UI integration as documented follow-on.

## Wave 0.5 — World primitive + interfaces + sparse matrix infrastructure (4 days) ✅

- [x] Landmark primitive in `src/specter/sim/world.py` (point landmarks via `Landmark` dataclass with stable IDs `lm-{ix}-{iy}`; `World.landmarks` tuple field; `box_world(..., landmarks=)` kwarg)
- [x] `LandmarkObservation { observer_id, landmark_id, range_m, bearing_rad, timestamp_ns, nlos }` in `messages.py` + `KIND_LANDMARK_OBSERVATION` constant + `_DECODER` wiring
- [x] TS port: `landmarks.ts` with `gridLandmarks()` + `landmarkVisible()` + `Landmark` type; `LandmarkObservation` + `KIND_LANDMARK_OBSERVATION` added to `messages.ts`; both exported from `index.ts`
- [x] New `PoseGraphSlam` interface in `interfaces.py` (sibling to `LocalSlam`) — methods: `add_odometry`, `add_landmark_observation`, `add_inter_robot_observation`, `optimize`, `trajectory()`, `landmarks()`, `factor_residuals()`. **Per-factor residual emission** via new `FactorResidual` dataclass (`factor_id`, `source_id`, `residual_norm`, `mahalanobis`, `reputation_at_insertion`, `iteration`) — preservation hook for Wave 6+ bidirectional adapter per ADR 0016 §2
- [x] Composition rule documented in `PoseGraphSlam` docstring + ADR 0006 addendum (single sentence): `PoseGraphSlam` consumes odometry from `LocalSlam.pose()`
- [x] **New `ui/packages/sim-core/src/sparseLinalg.ts` skeleton**: `CSCMatrix` type matching `scipy.sparse.csc_matrix` storage exactly (indptr/indices/data); `cscFromTriplets` (coalesces duplicates, canonicalizes ascending-row within-column order), `denseToCsc`, `cscToDense`, `cscTranspose`, `cscMatVec`, `cscNnz`. Full sparse Cholesky + AMD lands in Wave 1.
- [x] Python sparse path uses `scipy.sparse` (already in `[workshop]` extra); `sksparse.cholmod` deferred to Wave 1 environment check
- [x] Parity fixture for landmark grid generation (3 cases: workshop_5m, workshop_2m, offset_origin) — TS `gridLandmarks` matches Python reference byte-equal to 12 decimals
- [x] Parity fixture for CSC encoding (3 cases: identity_3x3, tridiag_4x4 representing 1D pose chain, mixed_5x5) — `denseToCsc` matches `scipy.sparse.csc_matrix.indptr/indices/data` byte-equal; `cscMatVec` matches `A @ x` to 10 decimals; `cscTranspose` is involutive to 12 decimals
- [x] ADR 0006 addendum: single-sentence composition rule landed

## Wave 1 — Single-agent pose graph (12 days) ✅

- [ ] Python `src/specter/slam/pose_graph.py` (~1100 LOC): SE(2) per [R9]/[R10] conventions, odometry factor with correct `t^1.5 / t^0.5` compounding [R6], landmark factor, **Levenberg-Marquardt with adaptive damping**, **GNC (Geman-McClure) with [R4] μ-schedule**, **sparse Cholesky on CSC matrices with AMD reordering** per [R11]
- [ ] TS port `ui/packages/sim-core/src/poseGraph.ts` + complete `sparseLinalg.ts` (AMD reordering ~300 LOC, symbolic factorization ~100 LOC, numeric sparse Cholesky ~150 LOC, sparse triangular solve ~50 LOC)
- [ ] Parity fixture `tests/fixtures/pose_graph.parity.json` (locked 10/8 decimals; includes GNC μ-trajectory)
- [ ] **Parity validation gate script**: runs fixture across (numpy macOS-arm64, numpy linux-x86_64, TS V8, TS JavaScriptCore); **fails CI if any platform misses 10/8** — implementation gets fixed (FLOP order, Kahan summation, AMD tie-breaker), target is NOT relaxed
- [ ] SE(2) on-manifold parity test against [R10] §4 reference values (exp / log / right-Jacobian)
- [ ] AMD reordering determinism test: verify lexicographic tie-breaker produces identical permutation across all four platforms
- [ ] Eval `tests/eval/test_single_agent_slam.py` — open-loop drift vs ground truth, bound from measured baseline
- [ ] Eval `tests/eval/test_lm_convergence.py` — LM inner-loop converges within 10 iterations per μ-level on the standard fixture
- [ ] Eval `tests/eval/test_gnc_outlier_suppression.py` — synthetic large-residual factor injection at varying outlier rates (10%, 30%, 50%); GNC suppresses outliers tighter than Huber baseline (Huber kept in test harness as comparison only)
- [ ] Eval `tests/eval/test_sparse_solver_correctness.py` — sparse + AMD result matches dense reference solver to 12 decimals on representative graphs (correctness gate before locking sparse as default)
- [ ] UI: trajectory ribbon on canvas
- [ ] `PROGRESS.md` entry + strikethrough

## Wave 2 — Loop closure (3 days) ✅

- [ ] ADR 0017: detection mechanism — landmark co-visibility for sim (clean); Mahalanobis-over-pose-uncertainty noted for hardware
- [ ] ADR 0017: false-positive rejection policy (distinct from Byzantine)
- [ ] `detect_loop_closure()` Python impl + TS port
- [ ] Loop closure factor type (same form as odometry, larger spatial gap)
- [ ] Parity fixture (deterministic detection, tolerance residuals)
- [ ] Eval `test_loop_closure_snap.py` — pre-closure drift ≫ post-closure drift, both measured
- [ ] Eval `test_false_loop_closure_rejected.py` — synthetic near-miss doesn't trigger
- [ ] UI: closure edges highlighted; historic trajectory re-renders on snap
- [ ] `PROGRESS.md` entry

## Wave 3 — Per-agent joint pose graphs + inter-agent alignment (7 days) ✅

- [ ] Inter-robot factor type: relative SE(2) constraint from range + bearing (residual function from ADR 0016 §5–§6)
- [ ] Gauge-freedom anchor: each agent pins its own pose-0 by direct elimination per ADR 0016 §12
- [ ] **Inter-agent frame alignment**: closed-form Sim(2) per Umeyama 1991 [R7] given ≥2 shared landmark correspondences; alignment-rejection threshold for adversarial cases (ADR 0019 if non-obvious)
- [ ] Per-agent `PoseGraphSlam` instantiation in `runScenario` (mirrors `agentEvaluators`)
- [ ] Keyframe + sliding-window strategy: ~50 active nodes per agent per optimizer call; older nodes marginalized via Schur complement (deterministic oldest-first per ADR 0016 §10)
- [ ] Optimization cadence: every N=25 ticks (tune after perf measurement)
- [ ] Perf benchmark: `optimize()` cost at N=25 × 4 agents; verify no freeplay regression vs commit `261cbe8`; FLOP-count check against ADR 0016 §11 budget
- [ ] Parity fixture for 4-agent joint optimization (per-agent views, deterministic)
- [ ] Eval `test_cooperative_slam_converges.py` — 4 honest agents, per-agent joint error < single-agent bound
- [ ] Eval `test_per_agent_slam_diverges_under_partition.py` — reuse `linkPredicate` from `partition_gossip`
- [ ] Eval `test_inter_agent_alignment_accuracy.py` — Sim(2) alignment recovers true relative pose to within sensor noise bounds; honest-peer scale ≈ 1
- [ ] UI: per-agent canvas overlay toggle
- [ ] `PROGRESS.md` entry

## Wave 4 — Reputation-weighted factors / exogenous-prior DCS (8 days, the demo) ✅

- [x] ADR 0018: reputation → `r` mapping (currently `r := reputation`; may need non-linear shaping for very-low-rep peers). Frame the contribution as exogenous-prior DCS per [R2] + [R8], not ad-hoc weighting. **Closed by ADR 0022 §4** — non-linear shaping landed via SC switch prior `γ_i(t) = γ_base · r_now · 10 + 0.01`; for the residual-evidence-bearing class of attacks this *is* the steepened-low-rep-tail behavior the open question anticipated. For the singleton-no-residual class, the cap + fade in ADR 0022 §§2–3 supply the orthogonal mechanism. Identity `r := reputation` remains the production default in the multiplicative composition; the non-linear shape moves into γ.
- [x] ADR 0018: explicit acknowledgment that effective factor information in GNC IRLS is `r · w · Ω` (reputation prior × GNC Geman-McClure weight × sensor information) — composition order matters. **Closed by ADR 0022 §5**: the production-default composition is now `Ω_eff = fade · singleton_cap · r_now · w_gnc · Ω_base` (five-piece, each with an independent evidence channel + opt-in gate + citation). The two-term `r · w · Ω` was the v1 statement.
- [ ] New `pose_lie` attack in `attacks.ts` (inter-robot observations inconsistent with truth, distinct from `range_lie`)
- [ ] Reputation lookup at factor insertion in `poseGraph.ts` (frozen-at-insertion per ADR 0016 §4)
- [ ] Eval `test_pose_lie_distortion.py` — naive (uniform `r=1`) joint error > X; reputation-weighted < X/10
- [ ] Eval `test_pose_lie_recovery.py` — once reputation drops, new factors enter low-weight; old marginalize as window slides
- [ ] Eval `test_gnc_plus_reputation_composition.py` — verify GNC + exogenous prior compose correctly; per-iteration effective weight matches `r · w(μ_k) · Ω` to parity tolerance; no double-counting
- [ ] `THREAT_MODEL.md` entry for `pose_lie` with measured bound (replaces notebook 04's "trust-layer no-op" note)
- [ ] Call out in ADR 0018: Mahalanobis residual is the same statistic the trust evaluator uses on range observations
- [ ] `PROGRESS.md` entry

**(Wave 4.5 removed in ADR 0016 v3 — GNC is no longer conditional; it ships as baseline in Wave 1.)**

## Wave 5 — UI integration + lessons (6 days) — scaffolds ✅, full UI integration is follow-on

- [ ] Pose graph canvas layer: nodes (keyframes only), edges (factors), colors by residual magnitude
- [ ] Landmark layer with uncertainty ellipses
- [ ] Trajectory ribbons with optimized-vs-raw toggle
- [ ] Per-agent view selector
- [ ] Inspector pane: per-peer factor residuals + reputation (mirrors `AgentRepList`)
- [ ] Lesson 09 — "Odometry vs SLAM: loop closure fixes drift" (Waves 1+2)
- [ ] Lesson 10 — "Cooperative SLAM: shared observations tighten the map" (Wave 3)
- [ ] Lesson 11 — "Byzantine SLAM: a lying peer distorts the joint map" (Wave 4 naive)
- [ ] Lesson 12 — "Reputation as a factor prior" (Wave 4 weighted)
- [ ] `WORKSHOP_OUTLINE.md` updated (UI catalog only; Jupyter curriculum unchanged)

---

## Hardware reconciliation (ADR 0006)

- [ ] `DeadReckoningSlam` / `ScanMatchSlam` remain streaming-pose providers on hardware
- [ ] `PoseGraphSlam` ABC satisfied on hardware by Cartographer (TurtleBot4) or Crazyflie UWB pose graph adapter
- [ ] `HARDWARE_READINESS.md` section: workshop SLAM ≠ hardware SLAM, contract is the ABC
- [ ] Wave 0.5 interface design audited for sim-only assumptions before merge

---

## Effort estimate (revised post-v3)

| Wave | Estimate | Cumulative |
|---|---|---|
| 0 — ADR 0016 v3 (literature audit + stakeholder upgrades) | 3 days | 3 days |
| 0.5 — world primitive + interfaces + sparse infra skeleton | 4 days | 1.5 weeks |
| 1 — single-agent pose graph (LM + GNC + sparse Cholesky + AMD + correct IMU + locked parity gate) | 12 days | 3.5 weeks |
| 2 — loop closure | 3 days | 4 weeks |
| 3 — per-agent joint graphs + Umeyama alignment | 7 days | 5.5 weeks |
| 4 — exogenous-prior DCS reputation weighting | 8 days | 7 weeks |
| 5 — UI + lessons | 6 days | 8 weeks |

**Total: 7–9 weeks of focused work.** Trajectory: v1 5–7w → v2 6–8w (literature audit added LM/Huber/correct IMU/empirical parity/Umeyama) → v3 7–9w (stakeholder upgrades: Huber→GNC, dense→sparse+AMD, locked 10/8 parity gate; conditional Wave 4.5 deleted because GNC is now baseline).

The extra weeks buy: production-grade defaults a PhD-audience reviewer expects (GNC + sparse Cholesky + AMD are what every production SLAM system uses), math that survives literature scrutiny, optimizer internally consistent with the threat model, locked-not-asserted parity guarantees, framing that makes the project's specific contribution (exogenous-prior DCS) legible against the literature.

## Tradeoff

Center of gravity shifts from *"Byzantine trust with a SLAM substrate"* to *"Byzantine-robust cooperative SLAM."* Larger surface (Tier 2 MDS, presence cascade, gossip must stay coherent with a much bigger optimizer layer). Worth it iff the audience expects SLAM.

The dual framing (production-grade MVP + workshop teaching tool) is not in tension — it's a constraint that improves both: correct math survives PhD review *and* teaches the right thing; auditable hand-rolled code serves the workshop *and* demonstrates the production-grade thesis end-to-end without third-party-optimizer opacity.
