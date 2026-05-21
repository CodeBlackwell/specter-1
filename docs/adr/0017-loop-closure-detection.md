ADR 0017: Loop closure detection — landmark co-visibility
==========================================================

Status: Accepted (2026-05-17) — SLAM_PLAN.md Wave 2.

Context
-------

ADR 0016 mandates loop closure as one of the four non-negotiables for
production-grade SLAM. Without it, the optimizer is a fixed-lag smoother
on odometry — drift grows monotonically. With it, the trajectory snaps
back when revisited landmarks indicate the agent is near a prior pose.

Two detection mechanisms are common in the literature:

- **Proximity in odometry frame**: cheap but wrong under drift — the
  odometry frame's "near" is the *predicted* near, which diverges from
  truth-frame near as drift accumulates. Real systems use this only as
  a candidate-generation step, gated by a second check.
- **Landmark co-visibility**: if pose `T_i` and `T_j` observe overlapping
  landmark sets (`|L_i ∩ L_j| ≥ τ`), they are *geometrically* near in
  the truth frame regardless of odometry drift. Clean for the workshop
  scenario where landmarks have stable IDs (per ADR 0016 §5).
- **Mahalanobis pose-uncertainty**: robust but requires covariance
  propagation through the pose graph — significant complexity.

Decision
--------

Workshop / MVP path uses **landmark co-visibility** detection:

- A loop closure between poses `T_i` and `T_j` is declared when:
  - `|i - j| ≥ MIN_KEYFRAME_GAP` (10) — adjacent keyframes don't count
    as loops; they're already constrained by sequential odometry.
  - `|L_i ∩ L_j| ≥ MIN_SHARED_LANDMARKS` (2) — two landmark
    correspondences are sufficient to determine the relative SE(2) pose
    (Umeyama, ADR 0019 forthcoming for Wave 3 multi-agent alignment).
- The closure constraint is encoded as a new `LoopClosureFactor` (same
  algebraic form as `OdometryFactor` — a relative SE(2) constraint
  between two poses).
- The relative measurement is computed from the shared-landmark
  geometry: minimum-residual SE(2) transform between the body-frame
  landmark observations from each pose (closed-form Umeyama on the
  shared subset).
- The closure factor's information matrix uses the **odometry factor's
  information at the inter-pose Δt** as a baseline, since the
  geometric closure has comparable precision to the integrated odometry
  at the closure distance.

False-positive rejection (separate from Byzantine — wrong self-closure
is its own failure mode):

- Closure candidate's geometric residual must be below
  `CLOSURE_RESIDUAL_TAU` (0.5 m). Above this, the candidate is rejected
  (likely a coincidental landmark-ID overlap from a non-loop revisit).
- A second-pass verification gates closure inclusion on the global
  cost: if adding the closure factor *increases* the optimizer's
  pre-LM cost beyond the closure's own contribution, the closure is
  inconsistent with the graph and is rejected.

Appearance-based loop closure (DBoW, NetVLAD, etc.) is deferred to the
hardware path where visual features are available. Workshop scenarios
have stable landmark IDs by construction.

Consequences
------------

Positive:

- Detection is clean and deterministic — landmark-ID overlap is a
  boolean predicate, not a thresholded similarity score.
- The closure factor reuses `OdometryFactor`'s algebra entirely; no new
  optimizer code paths.
- Workshop pedagogy is direct: the "agent returned to a known place"
  story maps onto landmark-set overlap visibly on the canvas.

Trade-offs accepted:

- Workshop SLAM and hardware SLAM diverge on closure detection —
  hardware uses appearance-based methods. The `PoseGraphSlam` ABC
  remains the interface contract; closure detection is implementation
  detail behind the ABC.
- `MIN_SHARED_LANDMARKS = 2` is the geometric minimum but offers no
  redundancy against landmark mis-identification. In adversarial
  settings (a peer fabricating landmark IDs), this would need to be
  raised. Out of scope for Wave 2; revisit if Wave 4 evals demand it.

Revisit when
------------

- Hardware integration replaces landmark IDs with appearance features
  (DBoW2, NetVLAD, etc.).
- A scenario emerges where the workshop legitimately benefits from
  Mahalanobis pose-uncertainty gating (e.g., long trajectories with no
  shared landmarks but tight pose uncertainty).
- A peer fabricates landmark IDs to inject false closures — would
  force reputation-gated closure ingestion (composes naturally with
  ADR 0018's exogenous-prior DCS).

Related
-------

- ADR 0016 — Pose-graph substrate. Loop closure factor is structurally
  identical to `OdometryFactor` (§5).
- ADR 0019 (forthcoming, Wave 3) — Inter-agent Sim(2) alignment via
  Umeyama. Same closed-form geometry as the closure's relative-pose
  measurement.
