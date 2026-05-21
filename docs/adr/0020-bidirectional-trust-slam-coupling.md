ADR 0020: Bidirectional trust ↔ SLAM coupling
==============================================

Status: Accepted (2026-05-17) — closes the loop ADR 0018 documented
as "one-way for now → bidirectional for future experimentation".

Context
-------

ADR 0018 wired reputation → SLAM (exogenous-prior DCS): low-rep peers
have their factor information matrices scaled down so a lie distorts
the joint map less. ADR 0015 deliberately scoped trust voting to
**range-only** evidence (reciprocal-range disagreement, Tier 2 MDS) —
explicitly *not* pose evidence, because pose lies have no reciprocal
partner to disagree with at the trust layer.

The asymmetry creates a known attack surface: an agent that lies
about its **own pose** (not about ranges) is invisible to ADR 0015's
trust evaluator. The lie is geometrically detectable — it produces a
large residual against landmark and inter-robot factors observed by
honest peers — but ADR 0018 only flows information in one direction
(trust → SLAM), so SLAM can't tell the trust evaluator what it sees.

This ADR closes the loop: SLAM factor residuals become evidence into
the trust evaluator, so the bidirectional coupling makes pose lies
collapse the offending peer's reputation, which then (via ADR 0018)
down-weights their future factors.

Decision
--------

1. **Evidence channel.** PoseGraph exposes
   `slam_residual_evidence(self_id) → {source_id: {"alpha": x, "beta": y}}`
   shaped for direct consumption by `BetaTrustEvaluator.observe`.

2. **Classification.** Per landmark / inter-robot factor at converged
   solution:
   - `χ² = rᵀ Ω r` using the **raw** information matrix (no GNC, no
     reputation weight applied — we want geometric fit, not weighted
     cost).
   - `χ² ≤ SLAM_CHISQ_INLIER (1.386)` → `+α 1.0` (50th-percentile
     honest-measurement bound for 2-DOF χ² table).
   - `χ² ≥ SLAM_CHISQ_OUTLIER (5.991)` → `+β 1.0` (95th-percentile
     inlier bound — anything beyond is statistically an outlier under
     the assumed sensor noise model).
   - Otherwise: no evidence emitted (keeps the evaluator quiet on
     uninformative measurements).

3. **Skips.** Three classes of factors emit nothing:
   - `OdometryFactor` — source_id is the agent itself → self-incrimination
     loop (an agent's own dead-reckoning drift would otherwise drive its
     own reputation down).
   - `LoopClosureFactor` — source_id is the literal `"loop_closure"`
     string → not a peer, no one to charge.
   - Caller's own `self_id` (when provided) — defensive skip for
     inter-robot factors observing the caller itself.

4. **Cycle discipline.** Callers invoke `slam_residual_evidence` **once
   per `optimize()` convergence**, then forward all returned evidence
   to the evaluator in one batch. Per-iteration emission would feed
   back into reputation weights mid-LM and oscillate.

5. **Full-loop wiring (optional).** Callers may close the full loop by
   `pg.set_reputation_source(evaluator.reputation)`. This combines with
   ADR 0018's un-frozen path so each LM step sees up-to-date rep, and
   each post-convergence emit shifts rep for the next solve. Validated
   stable for ≥5 cycles in tests/test_pose_graph_bidirectional_trust.py.

Stability
---------

The chicken-and-egg risk: low rep → factor down-weighted → factor's
contribution to the residual lessens (in the *weighted* cost) but the
**raw** χ² we use for classification is independent of rep. So the
classification doesn't depend on the previous cycle's rep — only on
the current geometry. This breaks the feedback loop at the
classification stage.

What can still oscillate: a borderline factor (`χ² ∈ (INLIER, OUTLIER)`)
might cross thresholds as the optimizer's solution wobbles between
cycles. We don't emit evidence for borderlines, so this is bounded —
the evaluator only sees clean signals.

GNC interaction: ADR 0018 + GNC compose multiplicatively
(`r · w_gnc · Ω`). After GNC convergence, outlier factors have
`w_gnc → 0` and the converged solution fits inliers precisely. The
χ² we compute then is exactly the "is this factor an outlier under
the consensus" question — strong inlier/outlier separation. Tests
exercise this via `optimize_gnc()` rather than `optimize()` for the
end-to-end lying-peer scenarios.

Composition rule update
-----------------------

ADR 0018 §2 said: effective weight = `r · w_gnc` (reputation prior +
GNC), reputation frozen at insertion per ADR 0016 §4. This ADR
amends per the un-freezing slice (#18 follow-on, 2026-05-17):

- Reputation lookup priority: live `_reputation_source` callable →
  frozen `_reputation_weights[key]` → 1.0 default.
- The live source is queried inside `_weight_of` on every assembly,
  so changes between `optimize()` calls take effect on the next LM
  step.

Thresholds rationale
--------------------

Standard chi-square table for 2-DOF (range + bearing residual):
- F⁻¹(0.50, df=2) ≈ 1.386 → 50% of honest measurements fall below
  → calling these "inlier" gives the evaluator a positive signal on
  geometrically-consistent reports.
- F⁻¹(0.95, df=2) ≈ 5.991 → 95% inlier bound; beyond is statistically
  outlier under the assumed Gaussian noise model.
- The gap between (1.386 ↔ 5.991) is the borderline band where we
  emit nothing — keeps noise from inflating Beta evidence.

For 3-DOF residuals (odometry / loop closure) the analogous thresholds
would be 2.366 / 7.815, but those factors are skipped per §3 above.

Open questions / future work
----------------------------

- **Asymmetric thresholds**: should `+β 1.0` always equal `+α 1.0`?
  Production systems often weight β heavier (security asymmetry: false
  negatives are more dangerous than false positives). Current
  symmetric weighting is the MVP default; a follow-on ADR could pin
  asymmetric weights backed by simulation studies.
- **Multi-cycle evidence cap**: this ADR specifies once-per-optimize.
  Some scenarios (continuous operation) may want a per-tick cap that
  prevents the same factor's evidence from re-emitting every cycle. A
  factor-key-keyed "last emitted" timestamp would implement this.
- **3-DOF emission**: we skip odometry/loop-closure today (self/non-peer
  source). A future variant could attribute odometry-edge residuals to
  the *trajectory inconsistencies* a peer reports (e.g., if peer A's
  claimed pose chain doesn't close), but that requires a richer
  source_id model.

References
----------

[R1] Standard χ² table values from Abramowitz & Stegun §26.4.
[R2] Pfister & Burgard "Multi-Agent SLAM with Defective Sensors" IROS
     2010 — early example of multi-robot residual-based trust
     down-weighting.
[R3] ADR 0015 (range-only trust voting), ADR 0016 (pose-graph
     substrate), ADR 0017 (loop closure detection), ADR 0018
     (reputation as factor prior).
