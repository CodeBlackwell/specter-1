ADR 0015: Range-only trust voting (Option B)
=============================================

Status: Accepted (2026-05-15) — Range-Only PRD waves 0–4 landed; `tests/eval/test_scale.py` gates the architectural property in CI.

Context
-------

`BetaTrustEvaluator` (pre-PRD) votes in world-absolute coordinates: each
observer's beacon return is projected through the observer's own SLAM-derived
pose into a "world" position, then compared against a median across observers
and the subject's self-pose.

This is architecturally broken. Every peer has a **private** SLAM frame that
drifts independently — `ScanMatchSlam` accumulates 0.5–6 m of drift over typical
demonstrator timescales depending on kinematics. The "world-absolute median" is
a comparison across coordinate systems that don't share an origin. Symptom:
the headline demo (`just demo` with `four_agents_corridor.yaml`) shows
honest rotating peers' reputation collapsing to ~0.23 while doing nothing
wrong, because their SLAM-private self-pose disagrees with the cross-frame
median of observer claims.

Removing rotation from the demo is a workaround, not a fix. The right answer
is to vote on the only frame-invariant scalar beacons emit: **range**.

Empirical inputs supporting this decision (verified pre-PRD):

- Reciprocal beacon coverage is **100%** across every tested scenario
  (6800/6800 pairs in the corridor scenario over 600 ticks). Beacon symmetry
  is geometric: `dist(A,B) ≤ max_range ⇔ dist(B,A) ≤ max_range`.
- Cohort observer-count `k` distribution: `k ∈ {2, 3}` for the corridor;
  `k=1` always for two-agent scenarios. Tier 1 must be the primary
  mechanism (works at any `k ≥ 1`); Tier 2 is a refinement when `k ≥ 3`.
- Cayley-Menger determinant blows up numerically at large N (16 orders of
  magnitude across N=4..20). **Eigenvalue-residual MDS** stays bounded
  (embeddability score 0.001 → 0.031 across N=4..20) and discriminates
  honest from colluder-pair geometries by 1.5–8.3×.
- MDS blame attribution: **9/9 colluder-pair trials at N=8..20** correctly
  identified both colluders in the top-2 residual ranking. Single-cohort
  blame at realistic σ=0.1m noise is 90% correct — multi-tick accumulation
  via the existing decay machinery drives false-positive rate down.
- Compute budget: 83–186 μs per cohort at N=4..20. Sub-millisecond, well
  inside the per-tick real-time budget.
- V2 self-anchored beacon defense (ADR 0009 + commit `6de52c0` lineage)
  composes orthogonally: sybils have no body, so honest peers never
  beacon them, so cabal-internal corroboration is zero-weighted *before*
  Tier 1 or Tier 2 fires. **Sybil resistance remains owned by V2; Option B
  handles real-bot attacks only.**

Decision
--------

Replace world-absolute voting in `BetaTrustEvaluator` with two-tier
range-only voting:

- **Tier 1** — pairwise reciprocal-range agreement
  `|r(O→S) − r(S→O)| ≤ k·σ_combined` where
  `σ_combined = sqrt(σ_beacon_range² + σ_beacon_range² + σ_NLOS²)`.
  Frame-free, `O(k)` per cohort, runs at any `k ≥ 1`. Award +α per
  agreeing pair; award +β per disagreeing pair to whichever side
  disagrees with the majority of the other peers' reciprocals.

- **Tier 2** — eigenvalue-residual classical MDS on the cohort distance
  matrix when `k ≥ 3`. Build symmetric `D` from
  `_obs_ranges + _subj_ranges + cross-observer ranges` harvested from the
  same cohort window. If `embeddability_score(D) > MDS_EMBEDDABILITY_TAU`
  (= 0.05), compute `per_point_residuals(D)` and charge β proportional to
  residual magnitude, capped at `MDS_BETA_CAP = 1.0` per cohort to bound
  single-cohort damage. Multi-tick accumulation via the existing
  exponential-decay machinery converts noisy per-cohort signal into a
  detection.

- **Subject self-pose exits the trust path entirely.** The subject's
  reported `(x, y, theta)` remains in `snapshot.py` for the ghost-pose
  visualization overlay, but never reaches `BetaTrustEvaluator`. The
  `geometric_inconsistency` anomaly category is renamed
  `range_inconsistency` and is now fired by subjects whose reciprocal
  ranges disagree with observers (Tier 1) or who appear as the
  top-residual peer in Tier 2.

- **`pose_lie` reclassifies to a map-merger anomaly.** A peer that lies
  about its own self-pose without lying about beacon ranges is
  geometrically inert at the trust layer (verified — `tests/eval/runner.py`
  pose_lie only mutates `PoseReport`, leaves beacon ranges untouched).
  The audit surface is preserved by adding two new attacks:
  - `range_lie(target, bias_m)` — target inflates outgoing beacon
    ranges (Tier 1 catches reciprocal disagreement).
  - `colluder_pair(a, b, bias_m)` — both colluders symmetrically inflate
    their mutual range (Tier 1 evades; Tier 2 catches).

- **Architectural property gated in CI.** New
  `tests/eval/test_scale.py::test_honest_swarm_n_bots_mixed_kinematics`
  parametrizes over `B ∈ {4, 16, 64}` with procedural mixed kinematics
  and asserts `min(rep across all viewer perspectives) > 0.8`. `B=200`
  is available via `SPECTER_SCALE=1`. This is the audit gate that
  prevents the regression Option B was built to fix.

Consequences
------------

Trade-offs accepted:

- `pose_lie`-only attacks become trust-layer no-ops. Threat model rewritten
  to reflect that an isolated pose-lie is a map-merger issue, not a trust
  issue. The new `range_lie` and `colluder_pair` attacks plug the audit gap.
- The `geometric_inconsistency` claim row in `THREAT_MODEL.md` is replaced
  with `range_inconsistency` + `range_lie_detection` rows; existing
  scripted bounds are recomputed.
- Observer theta exits the trust path. Visualization paths that need
  body-frame projections (the ghost-pose triangle, notebook 04's
  triangulation 2D) project locally from `(range_m, bearing_rad)` at the
  render site.
- `Observation` wire format changes: `rel_x, rel_y` replaced by `range_m,
  bearing_rad` (clean break — no consumers outside the repo). ADR 0003
  amended.

Audit surface preserved:

- Detection latency for `range_lie` ≤ Tier-1 reciprocal-check threshold
  (1–3 ticks).
- Detection latency for `colluder_pair` ≤ Tier-2 MDS multi-tick
  accumulation (5–10 ticks at σ=0.1m).
- Sybil ceiling still owned by V2 self-anchored beacon defense (4:3,
  unchanged).
- The corridor scenario's rotation drift is no longer a trust-layer
  problem — SLAM drift is silently absorbed because it never enters
  the trust path.

Revisit when
------------

Real hardware testing reveals one or more of:

- NLOS multipath range biases large enough to defeat reciprocal check
  even on honest peers (would require adaptive σ from observed
  beacon-noise statistics).
- Persistent collusion patterns that defeat both Tier 1 and Tier 2
  (e.g. 3+ colluders coordinating a globally-consistent shifted geometry
  — would require multilateration constraints from external anchors).
- N > 200 swarms where MDS cubic cost becomes the per-tick bottleneck
  (would require local-only cohort restriction by beacon neighborhood —
  already implicit via beacon range cap, but may need explicit pruning).

Related work and differentiation
--------------------------------

The closest published threats to the novelty of Tier 1 reciprocal-range
voting, Tier 2 MDS-embeddability blame attribution, and the V3
transitive presence rule (see `evaluator.py`) are catalogued here. Full
citations live in `docs/SYSTEM_ASSESSMENT.md` §10.

- **Huang et al., *ScatterID*, IEEE/ACM ToN 29(2), 2021** (closest threat
  to the V3 transitive presence rule). ScatterID defeats colluding Sybil
  attackers in robotic networks by inducing rich multipath signatures
  through backscatter tags and classifying identity legitimacy with a
  customized random forest on signal-space similarity vectors. The
  detection signal is **physical-layer signature dissimilarity**, the
  output is **per-node classification** (~95.4% accuracy, AUROC 0.987),
  and the defense against collusion is **signal-space spatial
  separation** — colluding Sybils cannot produce sufficiently dissimilar
  multipath responses without being co-located. This is a fundamentally
  different mechanism class. Specter-1's V3 presence rule does not need
  backscatter tags or any physical-layer-specific hardware; it operates
  on the same UWB ranges already used for localization, and defeats
  gossip-mutual collusion via a **self-rooted transitive ranging chain
  with explicit freshness window** rather than per-node signal-space
  classification. ScatterID requires custom backscatter infrastructure;
  V3 presence requires only ranging.

- **Clark et al., *SMILE: Robust Network Localization via Sparse and
  Low-Rank Matrix Decomposition*, arXiv:2301.11450, 2023** (closest
  threat to Tier 2 MDS-embeddability blame attribution). SMILE
  decomposes the Gram matrix derived from the distance matrix into a
  low-rank component (clean distances) and a sparse component
  (outlier-corrupted entries), then applies LLE post-decomposition for
  the final embedding. The sparse component identifies outliers
  **per-pair**, addresses both random noise and adversarial measurement
  corruption, and is designed to recover from sparse partial
  observations. Specter-1's Tier 2 differs along three dimensions:
  (1) the decomposition is **eigenvalue-residual classical MDS**
  (double-centered distance matrix → spectral decomposition) rather
  than RPCA-style low-rank + sparse; (2) blame is attributed
  **per-point** (per-cohort-member), not per-pair, which is the right
  level of attribution for the trust evaluator's per-peer Beta(α,β)
  evidence ledger; (3) the Tier 2 verdict is composed with Tier 1
  reciprocal-range agreement at the Beta-evidence level, not fused at
  the embedding level. SMILE is the more general localization-recovery
  method; Tier 2 is a narrower Byzantine-detector that pipes into a
  separate trust state.

- **Trosset, *Goodness-of-Fit Filtering in Classical MDS*, JAS 2019**
  (closest threat to per-point MDS residual scoring). Trosset's method
  computes per-point and per-pair goodness-of-fit statistics on a
  classical MDS embedding and uses them to filter out non-conforming
  observations. It is designed for **legitimate noisy data**, not
  adversarial outliers, and there is no collusion model. Specter-1's
  Tier 2 borrows the per-point residual *idea* but applies it under an
  explicit adversarial threat model (range-bias attacks with named
  amplitude `RANGE_LIE_BIAS_M = 3.0`, colluder-pair coordination), with
  blame-attribution thresholds chosen to discriminate honest
  measurement noise from coordinated bias (empirically: 9/9 colluder
  pairs correctly attributed at N=8..20, see ADR text above).

- The **Cayley-Menger determinant** is the textbook alternative to
  eigenvalue-residual MDS for embeddability testing. Pre-PRD
  measurements showed the CM determinant blows up across 16 orders of
  magnitude as N grows from 4 to 20, while eigenvalue-residual MDS
  stays bounded with 1.5–8.3× discrimination between honest and
  colluder geometries. No published head-to-head between CM and
  eigenvalue-MDS as Byzantine detectors at this scale appears in the
  searched literature — the comparison is the subject of the
  forthcoming workshop note (`docs/papers/cm_vs_mds.md`).

Related
-------

- ADR 0002 — Beta(α, β) + ECDSA. Unchanged; this PRD modifies how
  evidence flows in, not the reputation math itself.
- ADR 0003 — Canonical JSON → protobuf. Amended for `Observation`
  field rename.
- ADR 0004 — Local-SLAM choice. Independent decision; this PRD makes
  SLAM choice irrelevant to trust correctness.
- ADR 0005 — Sensor realism budget. `range_m, bearing_rad` promoted
  from "realism flavor" to "the only scalars trust consumes."
- ADR 0007 — Scan-match radial flow. Independent; corridor drift
  symptom that motivated this PRD goes away regardless.
- ADR 0009 — Attestation interface. V2 self-anchored beacon defense
  composes with Option B; sybil filtering is still V2's job.
- ADR 0013 — Decay window calibration. Exponential-decay machinery
  unchanged; Tier 2's fractional-β charge integrates cleanly via the
  existing `_decay()` logic.
- ADR 0014 — Workshop notebooks as audit surface. Mandates that
  notebooks 04, 05, 08, 09 update in the same slice.
