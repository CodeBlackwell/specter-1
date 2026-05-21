# SPECTER-1 Workshop — Jupyter Notebook Curriculum

**A 9-notebook tour of Byzantine-resilient cooperative SLAM, with every
claim backed by a measured test.**

You can watch a 30-second YouTube explainer of cooperative SLAM, or you
can spend 30 minutes here and walk away knowing — concretely — how to
detect a robot that's lying about where it is, what a Sybil cabal looks
like in the wild, why mutual corroboration isn't enough, and which exact
line of which exact file you'd subclass to port the whole stack to a
TurtleBot4.

This is the same demonstrator that runs in `examples/unified_demo.py`,
sliced into 9 layers. The notebooks import `specter.*` directly — no
parallel reimplementation, no drift. CI re-executes every notebook on
every PR via `nbconvert --execute`; if the library changes shape, the
notebooks fail the build.

---

## Table of contents

- [Bottom line](#bottom-line)
- [Setup](#setup)
- [Audience-specific reading paths](#audience-specific-reading-paths)
- [Why this curriculum exists](#why-this-curriculum-exists)
- [Cell taxonomy (per ADR 0014)](#cell-taxonomy-per-adr-0014)
- [Primer: range-only trust voting (ADR 0015)](#primer-range-only-trust-voting-adr-0015)
- [Teaching index](#teaching-index)
- [Cross-reference — notebooks ↔ React Workshop Console rail](#cross-reference--notebooks--react-workshop-console-rail)
- [Glossary — terms, variables, constants](#glossary--terms-variables-constants)
- [Conventions you'll see in every notebook](#conventions-youll-see-in-every-notebook)
- [Troubleshooting](#troubleshooting)
- [SROS2 caveat](#sros2-caveat)
- [Where things live](#where-things-live)
- [Going deeper](#going-deeper)
- [Contributing a new notebook](#contributing-a-new-notebook)

---

## Bottom line

- **9 notebooks**, 30–90 s each, < 5 min total laptop wall-clock.
- **Three cell types** per notebook: *intuition* (build mental model),
  *claim* (assert a measured bound from `tests/eval/`), *limit*
  (link the residual gap in `THREAT_MODEL.md` / `HARDWARE_READINESS.md`).
- **Import-only.** Notebooks call the real library; visualizations come
  from `specter.viz.notebook`. No inlined math, no rot when the
  library evolves.
- **CI-gated.** `.github/workflows/ci.yml` runs every notebook
  end-to-end via `nbconvert --execute` on every PR. Drift fails the
  build.
- **Graceful degradation.** Notebook 09's SROS2 appendix prints an
  install hint and skips when `rclpy` is absent.

ADR 0014 codifies the discipline.

---

## Setup

Three commands, no Docker required:

```bash
git clone <repo> && cd specter-1
uv sync --all-extras
uv run jupyter lab notebooks/
```

Or run all 9 end-to-end without opening a UI:

```bash
just workshop-check                  # nbconvert --execute every notebook
```

Headless execution requires `MPLBACKEND=Agg`; the `just` target sets it.

The `[workshop]` extra brings in `jupyterlab`, `matplotlib`,
`ipywidgets`, `scipy`, `nbclient`. The optional `[ros2]` path is
**not pip-installable** — see [SROS2 caveat](#sros2-caveat) below.

---

## Audience-specific reading paths

Different readers want different things. Pick your lane:

| If you are… | Read | Why |
|---|---|---|
| **Hardware integrator** porting to TurtleBot4 / Crazyflie+UWB | 09 → 01 → 02 → 06 → 07 | Notebook 09's ABC-seam diagram is the porting contract; the others provide context for each subclassed seam |
| **Reviewer** doing a 30-min top-down read | 01 → 03 → 06 → 08 → 09 | Each ends with a measured claim cell citing `tests/eval/`; you can stop after any notebook and have a verified subclaim |
| **Security engineer** auditing the trust math | 03 → 04 → 08 → 02 | Beta dynamics + voting + battery + identity — the math surface |
| **Robotics researcher** comparing approaches | 05 → 06 → 07 → 09 | Sim realism budget, SLAM variants, occupancy fusion, full composition |
| **Manager / stakeholder** | Just 09 | The composition notebook is the demo in cell form. Skim the others as needed |
| **Curious first-time visitor** | 01 → 03 → 09 | Crypto envelope → reputation math → "now watch them work together" |

---

## Why this curriculum exists

Most "secure robotics" teaching material is one of:

- A lecture deck with no running code.
- A research paper whose code doesn't compile.
- A "tutorial" that hand-rolls toy versions of the very systems it teaches.

This curriculum is none of those. It is the *real* demonstrator, sliced
into 9 layers, executed by `nbconvert --execute` in CI. Every notebook
is import-only — if a library function gets renamed, the notebook fails
the build before a single learner is misled.

The three-cell discipline (*intuition* / *claim* / *limit*) exists because
honest engineering means each of those three jobs is different:

- **Intuition** is for building the mental model. Slide a slider; plot
  a curve. Never reimplement the library.
- **Claim** is for asserting a measured bound — pinned to a specific test
  in `tests/eval/`. The variant in-cell is short; the audit test is the
  source of truth.
- **Limit** is for naming the residual gap. Mock attestation is not real
  TPM. The 4:3 Sybil ceiling is real. Saying so out loud builds trust.

---

## Cell taxonomy (per ADR 0014)

Every notebook has at least one of each cell type. Look for the section
heading.

| Type | Purpose | Example | What it never does |
|---|---|---|---|
| **Intuition** | Build mental model — plot, inspect, single-message demo. Uses the library; never inlines math. | "slide α and β; watch the prior become a posterior" | Reimplement library logic |
| **Claim** | Cite a measured bound from `tests/eval/`. Run a short variant in-cell; reference the full audit test. | "26× drift cut from `tests/eval/test_slam_drift.py`" | Make assertions without a backing test |
| **Limit** | Link the residual-gap section in `THREAT_MODEL.md` or `HARDWARE_READINESS.md` or an ADR. | "`MockAttestationProvider` is allowlist-based; real TPM is Phase 4" | Oversell |

---

## Primer: range-only trust voting (ADR 0015)

Notebook 04 teaches this in detail; this primer lets the rest of the
curriculum reference it without re-deriving the math.

**Why range, not position.** Every peer runs its own SLAM in its own
private frame; that frame drifts independently of every other peer's.
A peer's reported `(x, y, θ)` is meaningful only inside its own frame,
so comparing "where peer X is" *across* peers' frames compares numbers
from different origins. `range_m` is frame-invariant by physics — a UWB
beacon measures distance between two transceivers regardless of either
side's coordinate system.

**Tier 1 — reciprocal-range agreement.** At every cohort close, for
each pair `(observer O, subject S)`:

```
| r(O→S) − r(S→O) | ≤ RANGE_RECIPROCAL_K_SIGMA · σ_combined
```

with `σ_combined = sqrt(2·σ_beacon² + σ_NLOS²) ≈ 0.165 m` and `k = 3.0`
(≈ 99.7% honest envelope). Source attribution: the side that disagrees
with the majority of other peers' reciprocals earns β. Catches
`range_lie`, `beacon_spoof`, and single-source `sensor_fuzz`.

**Tier 2 — eigenvalue-residual classical MDS.** When `k ≥ 3`, build a
symmetric distance matrix `D` from all available pairwise ranges in the
cohort. Eigendecompose `B = −½·J·D²·J`; honest geometries are
2D-embeddable so eigenvalue mass concentrates in the top 2 modes.
Compute:

```
embeddability_score(D) = sum(|λ_k|, k ≥ 2) / sum(|λ_0|, |λ_1|)
```

Above `MDS_EMBEDDABILITY_TAU = 0.05`, locate the lying edge by triangle
inequality (`lying_edge_residuals(D)`):

| Signature | Detection |
|---|---|
| Peer appears in ≥ 2 lying edges, ≥ 2× any other peer | single-source attacker |
| Exactly one lying edge, both endpoints exceed threshold | colluder pair |

β capped at `MDS_BETA_CAP = 1.0` per cohort. Catches `colluder_pair`
(symmetric mutual-range inflation that Tier 1 sees as agreement) and
sharpens source attribution for `sensor_fuzz` / `odometry_corrupt`.

**What's *out* of the trust path.**
- `PoseReport.x, y, theta` — used by the map merger (ADR 0010) and the
  ghost-pose visualization, but **never reaches** `BetaTrustEvaluator`.
  `pose_lie` is therefore a trust-layer no-op as of ADR 0015 — flagged
  by the merger as a misaligned occupancy fragment, not by the trust engine.
- `Observation.bearing_rad` — used by the simulator (sybil geometry) and
  visualization helpers; not consumed by Tier 1 or Tier 2.
- SLAM drift — silently absorbed. The corridor demo's pre-ADR-0015
  reputation collapse on honest rotating peers is regression-gated by
  `tests/eval/test_scale.py`.

**Architectural property gated in CI.** `tests/eval/test_scale.py`
procedurally builds N agents — half rotating (`omega ≠ 0`), half pure-
translation — and asserts `min(rep across all viewer→peer pairs) > 0.5`
at B ∈ {4, 16} default, {64, 200} opt-in via `SPECTER_SCALE=1`. This is
the property the world-absolute voting failed to satisfy and Option B
was built to lock.

---

## Teaching index

Ordered by the project's dependency graph — trust trunk first, SLAM
trunk second, composition last. Each row's "claim source" is the
audit-grade test the notebook cites.

| # | Notebook | Teaches | Visualizations | Claim source | Limit source |
|---|---|---|---|---|---|
| **01** | `01_signed_envelopes_and_bus.ipynb` | ECDSA-signed envelopes, the 5 rejection categories, the receive pipeline | (text + verdict log) | `tests/test_secure_bus.py` | `THREAT_MODEL.md` § hardware-key-compromise |
| **02** | `02_identity_lifecycle.ipynb` | `MutableRoster`, `KeyRotationAnnouncement`, `RevocationList`, `MockAttestationProvider` | (text + boolean checks) | `tests/eval/test_identity_attacks.py` | ADR 0009 — mock attestation; Phase-4 hardware |
| **03** | `03_beta_reputation_and_decay.ipynb` | Beta(α, β) reputation, `record_accept` α-tightening, 10s exponential decay | Beta-PDF interactive sliders, decay trajectory | `tests/eval/test_calibration.py` (ADR 0013) | Decay constant tuning deferred to Phase 1+ radio measurements |
| **04** | `04_voting_triangulation_gossip.ipynb` | Cohort-close range voting — Tier 1 reciprocal-range, Tier 2 MDS multilateration, reputation gossip (ADR 0015) | Cohort timeline, range-circle 2D, sparkline | `tests/eval/test_attack_battery.py` (`range_lie`, `colluder_pair`) + `tests/eval/test_scale.py` | Architectural property gated at B ∈ {4, 16}; B ∈ {64, 200} opt-in via `SPECTER_SCALE=1` |
| **05** | `05_sim_and_sensor_realism.ipynb` | Sim ticking, lidar dropouts, IMU bias drift, UWB beacons — `range_m + bearing_rad` are now the only scalars the trust engine consumes (ADR 0015) | World figure, drop-rate histogram | ADR 0005 sensor budget | Simulated noise only; no Gazebo PointCloud2 yet |
| **06** | `06_slam_dead_reckoning_to_scan_match.ipynb` | `DeadReckoningSlam` (negative test) → `ScanMatchSlam` (default), radial-flow LSQ | Trajectory overlay, radial-flow diagram | `tests/eval/test_slam_drift.py` (ADR 0007) | Theta gyro-driven; no full pose-graph optimization |
| **07** | `07_cooperative_map_merge.ipynb` | `OccupancyMapMerger`, free-vote / occupied-vote weights, trust-weighted fusion | Three-panel heatmap, side-by-side weighted vs uniform | `tests/eval/test_map_convergence.py` (ADR 0010) | Pose correction out of scope; merger trusts the trust scalar |
| **08** | `08_attack_battery_tour.ipynb` | Guided tour of all 12 scripted attack scenarios | Small-multiples 4×3 grid, rep(t) per scenario | `tests/eval/test_attack_battery.py` + `THREAT_MODEL.md` table | Detection bounds, not pose-correction bounds; short variants may not reach canonical detection ticks |
| **09** | `09_full_byzantine_swarm.ipynb` | Full composition via `specter.demo` primitives + SROS2 transport-swap appendix | Sim animation, reputation sparkline, ABC-seam diagram (`docs/abc_seams.svg`) | `examples/unified_demo.py` + `tests/test_sros2.py` (ADR 0011) | rclpy required for appendix; Phase-1 hardware criteria in `HARDWARE_READINESS.md` |

---

## Cross-reference — notebooks ↔ React Workshop Console rail

The React UI at `ui/packages/app` runs an 8-lesson operator-resonance rail
(see `ui/packages/app/src/data/lessons.ts`). It's a different curriculum
shape — visual, hands-on, organized around "what would an operator ask?"
rather than around library concept layers. Both surfaces teach the same
underlying defenses; the table below maps them together so a reader who
started on one can find the matching cell on the other.

| Rail lesson | Operator question | Rail scenario(s) | Python notebook(s) covering the same defense |
|---|---|---|---|
| **L01** The wire is hostile | What about adversaries who never join the swarm? | `forged_envelope` + `replay_storm` | **01** (envelope sig + 5 rejection categories), **02** (roster boundary), **08** (`forged_envelope` row added in Coverage Parity Wave 3.5 — external X0 keypair with no roster entry, every envelope rejected at `open_envelope`) |
| **L02** Reputation that forgives | If a drone has one bad tick, is it banned forever? | `recovery_after_lie` | **03** (Beta + decay math; recovery half-life is the back-half), **08** (`liar_then_heals` in the battery — upgraded in Coverage Parity Wave 1 from pose_lie no-op to range_lie+heal so the dip-then-recover trajectory is actually exercised on both surfaces) |
| **L03** When two liars agree | What catches lies pairwise checks can't? | `colluder_pair` | **04** (Tier 2 MDS derivation), **08** (`colluder_pair` in the battery) |
| **L04** Bad data ≠ bad actor | Does this thing false-alarm on NLOS / multipath? | `sensor_fuzz` | **05** (sensor noise budget), **08** (`sensor_fuzz` in the battery) |
| **L05** The sleeper agent | What if a drone is honest for an hour, then flips? | `late_range_lie` | **08** runs `late_range_lie` (Coverage Parity Wave 1 — range-layer sleeper with measured detection latency curve in `tests/eval/test_late_range_lie_detected_after_wake`). `sleeper_pose_liar` remains as the pose-layer analogue (declared trust-noop per ADR 0015). |
| **L06** When the swarm splits | If comms drop mid-mission, do both halves converge? | `partition_gossip` | **04** (derives gossip math + runs `partition_gossip` live as of Coverage Parity Wave 2), **08** (partition_gossip row in the battery). Empirical: cross-clique gossip-only view settles at ~0.73, *above* the 0.4 threshold — exposes the limit of gossip-only reconciliation. |
| **L07** Agents that never were | What stops the adversary spinning up fake drones? | `sybil_cabal` | **02** (identity / roster), **04** (V3 presence is the math), **08** (`sybil_flood` + `sybil_flood_mutual`); `test_sybil_cabal_mutual_gossip_cannot_manufacture_presence` in `tests/test_trust_evaluator.py` is the property the rail demos |
| **L08** Attacks on the map itself | What if a drone lies about what's on the ground? | `cop_corruption_full` | **07** (trust-weighted COP fusion + new live composite attack cell as of Coverage Parity Wave 3, ADR 0019), **08** (`cop_phantom`, `cop_suppress`, `cop_fob_corrupt`, `cop_corruption_full` rows in the battery). All four map-layer scenarios now have measured bounds in `THREAT_MODEL.md`. **ADR 0022 addendum (2026-05-18):** notebook 08 now includes a SLAM-layer demo of the singleton-trusted-window lie — a peer that lies *while still trusted* about a landmark only they ever observe, structurally invisible to every other detection mechanism in the battery. Defense: singleton confidence cap (`Ω_eff = 0.3 · r_now · Ω_base`, 3.3× rep-independent reduction) + stale-singleton fade (decay to 0 over `T_CORROBORATE + T_FADE = 400` ticks). Measured by `test_pose_graph_singleton.py`. |
| **L13** Who's allowed to talk | What if the threat isn't a bad observation but a bad identity? | `bad_key` | **02** (identity-lifecycle: MutableRoster, KeyRotationAnnouncement, RevocationList) + new live `single_bad_key` cell as of Coverage Parity Wave 4. **08** (`single_bad_key` row in the battery). |

### What the rail teaches that this Python curriculum doesn't yet show

The React rail introduced four scenarios that have no `tests/eval/`
counterpart. They are rail-only today; promoting any of them to an
audit-grade Python eval would land per the eval-first methodology
(`PROGRESS.md` slice + `tests/eval/scenarios.py` entry + measured bound
in `THREAT_MODEL.md`):

- ~~`forged_envelope`~~ ✅ landed in Coverage Parity Wave 3.5 — external X0 keypair without roster entry; per-tick observation emission; receivers raise `VerificationError("unknown_sender")` at `open_envelope`; trust evaluator untouched. `test_forged_envelope_rejected_at_wire_boundary` asserts real-agent reps stay > 0.9.
- ~~`late_range_lie`~~ ✅ landed in Coverage Parity Wave 1 — Python scenario in `tests/eval/scenarios.py` + measured-bound test (`test_late_range_lie_detected_after_wake`) + THREAT_MODEL.md row.
- ~~`partition_gossip`~~ ✅ landed in Coverage Parity Wave 2 — runner `link_predicate` + scenario + measured-bound test (`test_partition_gossip_asymmetric_detection`) + notebook 04 live cell. The empirical finding (cross-clique view settles at ~0.73, not below threshold) is documented in `THREAT_MODEL.md` as a measured limit.
- ~~`cop_corruption_full`~~ ✅ landed in Coverage Parity Wave 3 (ADR 0019) — composite + `cop_phantom` + `cop_suppress` + `cop_fob_corrupt` all run as Python eval scenarios with measured bounds in `THREAT_MODEL.md` and a live demo cell in notebook 07.

These are tracked in `docs/WORKSHOP_UX_GAPS.md` § *Attack-space gaps in
the catalog*. The notebook curriculum is import-only against the Python
library — it can't run scenarios that don't exist on the Python side.

---

## Glossary — terms, variables, constants

Every term you'll see in the notebooks, where it's formally defined, what it
means in one line, and (where applicable) the numeric value or default.

### Cryptographic and identity terms

| Term | Defined in | One-line meaning | Value / default |
|---|---|---|---|
| **Envelope** | `src/specter/secure_bus.py` | Signed wire-format wrapper carrying `(kind, payload, sender, nonce, timestamp, signature)` | — |
| **ECDSA** | `src/specter/secure_bus.py` | Elliptic Curve Digital Signature Algorithm — public-key signing primitive | NIST P-256 |
| **Roster** | `src/specter/secure_bus.py`, `src/specter/identity/roster_runtime.py` | Map from `agent_id` → `pubkey`. `MutableRoster` adds rotation history | — |
| **Replay window** | `src/specter/secure_bus.py` | Per-sender strict-monotonic nonce gate; rejects anything not strictly newer | per-sender FIFO |
| **Nonce** | `src/specter/secure_bus.py` | Per-sender monotonic counter on every envelope; gates against replay | uint64 |
| **Attestation** | ADR 0009, `src/specter/identity/attestation.py` | TPM/Secure-Enclave allowlist gate; mock impl ships, real impl is Phase 4 | mock allowlist |
| **`KeyRotationAnnouncement`** | `src/specter/identity/` | Signed message authorizing a new pubkey using the old key | — |
| **`RevocationList`** | `src/specter/identity/` | Forward-only blocklist of revoked pubkeys, time-aware | — |
| **`DEFAULT_MAX_SKEW_NS`** | `src/specter/transport/` (`validate_timestamp`) | Wall-clock skew filter — envelopes with `\|ts - now\|` past this rejected | `5_000_000_000` ns (5 s, ADR 0008) |
| **Rejection categories** | `src/specter/secure_bus.py` errors | Five categorized verdicts: `bad_signature`, `unknown_sender`, `replay`, `version_mismatch`, `clock_skew_*` | — |
| **`unattested_key`** | `src/specter/identity/attestation.py` | Rejection when sender's pubkey isn't on the attestation allowlist | — |
| **`key_revoked` / `key_revoked_post_rotation`** | `src/specter/identity/` | Rejection for envelopes signed by a key on the revocation list, or by a rotated-out key | — |

### Trust math terms

| Term | Defined in | One-line meaning | Value / default |
|---|---|---|---|
| **Beta(α, β)** | ADR 0002, `src/specter/trust/evaluator.py` | Per-peer reputation distribution; `reputation = α / (α + β)` | prior `(1, 1)` |
| **α (alpha)** | `evaluator.py` | Evidence count for "this peer is honest" | starts at 1 |
| **β (beta)** | `evaluator.py` | Evidence count for "this peer is lying" | starts at 1 |
| **`ACCEPT_ALPHA`** | `evaluator.py` | α earned for a valid signature alone (tightened so behavior dominates) | `0.1` |
| **`record_accept`** | `evaluator.py` | Called on every successfully verified envelope; awards `ACCEPT_ALPHA` α | — |
| **Decay half-life** | ADR 0013, `evaluator.py` | Exponential decay of evidence above prior toward `(1, 1)` | 10 s |
| **`GOSSIP_DISCOUNT`** | `messages.py`, `evaluator.py` | Weight applied to incoming reputation gossip from a peer | `0.1` |
| **`MIN_OBSERVER_WEIGHT`** | `evaluator.py` | Per-observer first-hand weight floor; observers below this don't contribute to Tier 1 voting | `0.1` |
| **Cohort-close** | commit `6de52c0`, `evaluator._vote_closed_cohorts` | Range vote fires only when a later-timestamp envelope arrives — fixed colluder bug | — |
| **Tier 1 (reciprocal range)** | ADR 0015, `evaluator._vote` | `\|r(O→S) − r(S→O)\| ≤ k·σ_combined` pairwise check at every cohort; frame-invariant; runs at any `k ≥ 1`; single-side blame via majority-of-reciprocals voting | — |
| **Tier 2 (MDS multilateration)** | ADR 0015, `src/specter/trust/mds.py` | Eigenvalue-residual classical MDS on the cohort distance matrix when `k ≥ 3`; triangle-inequality lying-edge residuals localize colluder pairs vs single-source attacks | — |
| **`RANGE_RECIPROCAL_K_SIGMA`** | `evaluator.py` | σ multiplier for Tier 1 reciprocal-range threshold | `3.0` (~99.7%) |
| **`MDS_EMBEDDABILITY_TAU`** | `evaluator.py` | Embeddability ratio above which Tier 2 fires β | `0.05` |
| **`MDS_BETA_CAP`** | `evaluator.py` | Per-cohort β cap from Tier 2 (bounds single-cohort damage) | `1.0` |
| **`MIN_K_FOR_TIER2`** | `evaluator.py` | Minimum observer count for Tier 2 (Cayley-Menger needs ≥3 in 2D) | `3` |
| **`range_m`, `bearing_rad`** | `messages.py` `Observation` | Frame-invariant beacon scalars — the only signal the trust engine consumes | — |
| **`SIGMA_BEACON_RANGE_M`** | `evaluator.py` | Beacon range noise model | `0.10 m` |
| **`SIGMA_NLOS_RANGE_M`** | `evaluator.py` | NLOS multipath range noise model | `0.07 m` |
| **`range_inconsistency`** | `evaluator._vote` | Anomaly category for Tier 1 reciprocal disagreement or Tier 2 top-residual peer | — |
| **Weighted median** | `evaluator.py` | Median computed with `_first_hand_score(observer)` as weight (still used internally for Tier 2 source attribution) | — |
| **Reputation gossip** | `messages.py` `KIND_REPUTATION` | α/β snapshot broadcast at ~1 Hz; receivers blend at `GOSSIP_DISCOUNT` weighted by gossiper's first-hand score | 1 Hz |
| **V2 self-anchored beacon defense** | `evaluator._has_presence` | Only the evaluator's *own* beacon Observations grant presence credit. Sybils have no body | — |
| **Presence window** | `evaluator._has_presence` | Time window in which a subject must have a recent beacon observation to be considered "present" | 2 s |
| **Detection threshold** | `THREAT_MODEL.md`, eval harness | Reputation below which a peer is considered detected as Byzantine | `0.4` |
| **Sybil ceiling** | `tests/eval/test_sybil_scale.py` | Maximum Sybil-to-honest ratio at which detection holds | `4:3` |

### SLAM and sim terms

| Term | Defined in | One-line meaning | Value / default |
|---|---|---|---|
| **`DeadReckoningSlam`** | ADR 0004, `src/specter/slam/dead_reckoning.py` | Theta from gyro, xy from held velocity. Retained as the negative-test baseline | drift 12.95 m at 200 ticks |
| **`ScanMatchSlam`** | ADR 0007, `src/specter/slam/scan_match.py` | Radial-flow LSQ velocity from consecutive lidar scans; theta still gyro-driven | default in eval/runner + demo |
| **Radial-flow LSQ** | `scan_match.py` | For each beam matched between scans, `Δr ≈ -(vx cos θ + vy sin θ) × dt`; pool 16 beams via 2×2 closed-form least-squares | beam-pool 16 |
| **Beam-jump filter** | `scan_match.py` | Skips beam pairs with `\|Δr\| > 0.5 m` — corner crossings | `0.5 m` |
| **Scan-match drift bound** | `tests/eval/test_slam_drift.py` | Asserted xy drift bound at fixed tick counts | `< 1.5 m` at 200 t, `< 2.0 m` at 400 t |
| **`OccupancyMapMerger`** | ADR 0010, `src/specter/slam/map_merger.py` | Trust-weighted free-vote / occupied-vote ray-casting fusion across peer fragments | — |
| **Map resolution** | `map_merger.py` | Grid cell size for occupancy fusion | `0.2 m` |
| **Free vote** | `map_merger.py` | Cell traversed by a ray — votes for "free" | weighted by `peer_weights[agent_id]` |
| **Occupied vote** | `map_merger.py` | Ray endpoint cell — votes for "occupied" | weighted by `peer_weights[agent_id]` |
| **Loop closure detection** | `src/specter/slam/loop_closure.py` | True iff ≥ 50% of valid scan endpoints land within `0.3 m` of an occupied cell. **Detection signal only — pose correction is out of scope** | `0.3 m`, ≥ 50% |
| **Min-3-valid-beams guard** | `loop_closure.py` | A dropout-only scan cannot trigger loop closure | min 3 beams |
| **Lidar dropout probability** | ADR 0005, `src/specter/sim/` | Per-beam probability of returning `math.inf` (no echo) | `P_DROP = 0.02` |
| **Range-dependent σ** | ADR 0005 | Lidar noise std-dev scales linearly with range | `σ = 1 + d/10` |
| **IMU bias drift** | ADR 0005 | Per-agent gyro bias evolves as a random walk | init σ=0.01, walk σ=0.0005/tick |
| **UWB beacon model** | ADR 0005 | DWM1000-class range noise + 5° PDOA bearing + 2% NLOS multipath | — |

### Transport and ROS 2 terms

| Term | Defined in | One-line meaning | Value / default |
|---|---|---|---|
| **`InProcessBus`** | `src/specter/transport/` | In-process synchronous bus; default in tests + demo | — |
| **`LossyBus`** | ADR 0008, `src/specter/transport/lossy_bus.py` | `MessageBus` wrapper adding seeded drop / jitter / reorder for radio-realism evals | — |
| **`Sros2Bus`** | ADR 0011, `src/specter/transport/sros2_bus.py` | Secure ROS 2 — DDS-Security extensions for ROS 2 (auth + access control + crypto). Ships envelopes through real DDS | — |
| **SROS2** | ADR 0011 | DDS-Security-enabled ROS 2 (signed-node enclaves, encrypted transport) | — |
| **`std_msgs/ByteMultiArray`** | `sros2_marshal.py` | ROS message type used as opaque carrier for canonical-JSON envelope bytes | — |
| **Per-topic QoS** | ADR 0012, `qos.py` | Per-topic `QoSProfile` — pose/beacon BEST_EFFORT, observation/reputation RELIABLE | — |
| **Battery detection budget** | `tests/eval/test_attack_battery.py` | Detection must hold within `2 × InProcessBus baseline + 5` ticks under any transport | — |
| **`make_secure_node`** | `sros2_bus.py` | Configures rclpy for SROS2 signed-node DDS (`ROS_SECURITY_*` env) before `rclpy.init()` | — |

### Eval / attack-battery terms

| Term | Defined in | One-line meaning |
|---|---|---|
| **Eval harness** | `tests/eval/runner.py` | `Scenario` / `AttackEvent` / `EvaluationResult` + `run_scenario()` — the audit surface |
| **`Scenario`** | `tests/eval/runner.py` | Declarative pack of agents + attacks + duration |
| **`AttackEvent`** | `tests/eval/runner.py` | Scheduled attack: `(tick, kind, target, params)` |
| **`EvaluationResult`** | `tests/eval/runner.py` | Detection latency + false-positive ticks + final rep matrix |
| **`swap_key`** | `runner.py` | Replace target's signing key → signatures fail (`bad_signature`) |
| **`pose_lie`** | `runner.py` | Target publishes self-pose with `(+3, +3)` offset — **trust-layer no-op as of ADR 0015**; flagged at the map-merger only |
| **`range_lie`** | `runner.py` | Target inflates outgoing beacon `range_m += 3 m` — caught at Tier 1 reciprocal disagreement |
| **`colluder_pair`** | `runner.py` | Two colluders symmetrically inflate their mutual range — caught at Tier 2 MDS triangle-inequality |
| **`sensor_fuzz`** | `runner.py` | Gaussian-noise observations → Tier 2 source attribution |
| **`replay_storm`** | `runner.py` | Re-publish captured envelope 10× per tick → bus replay-rejections accumulate β |
| **`odometry_corrupt`** | `runner.py` | Broken IMU → SLAM theta drifts → observations rotate around attacker |
| **`beacon_spoof`** | `runner.py` | Constant `+3 m` range bias on all observations |
| **`heal`** | `runner.py` | Stop attacking; rebuilds reputation via decay |
| **`SybilSpec`** | `runner.py` | Forged identities added to roster mid-scenario; per-tick fake corroborations |
| **`sybil_flood`** | `runner.py` | N sybils corroborate a target attacker's pose-lie |
| **`sybil_flood_mutual`** | `runner.py` | Sybils publish fake Observations of each other (defeats naive defenses) |

### Workshop / project structure terms

| Term | Defined in | One-line meaning |
|---|---|---|
| **ABC seam** | `interfaces.py`, `docs/abc_seams.svg` | A subclass-here boundary the hardware integrator overrides for TurtleBot4 / Crazyflie+UWB |
| **`specter.demo` orchestration** | `src/specter/demo/` | Shared primitives — `build_swarm`, `step`, `apply_attack`, `snapshot`, `RenderSnapshot` — used by both `unified_demo.py` and the notebooks |
| **Intuition / Claim / Limit** | ADR 0014 | The three required cell types per notebook |
| **Workshop accessors** | `tests/test_workshop_accessors.py` | Five small read-only library methods the notebooks rely on (`cohort_events`, `pending_cohorts`, `matched_pairs`, `merge_with_votes`, `run_scenario(traces=...)`) |
| **`ReputationTrace`** | `src/specter/viz/` | Per-viewer ring buffer of α/β trajectories for sparkline rendering |

---

## Conventions you'll see in every notebook

```python
# First code cell of every notebook:
import os
from pathlib import Path
_root = Path.cwd().parent if Path.cwd().name == 'notebooks' else Path.cwd()
os.chdir(_root)
```

This makes `scenarios/*.yaml` paths resolve regardless of whether the
notebook is launched from the project root (`uv run jupyter lab`) or
from `notebooks/` directly.

```python
%matplotlib inline
```

Inline rendering. Switch to `%matplotlib widget` if you want
interactive zoom/pan (requires `ipympl`).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: matplotlib` | `[workshop]` extra not installed | `uv sync --all-extras` |
| `FileNotFoundError: scenarios/two_agents.yaml` | Notebook launched from `notebooks/` and the chdir cell didn't run | Run the first code cell first; or launch from project root |
| `ipywidgets sliders show nothing` | JupyterLab extension not enabled | `uv run jupyter labextension list` then enable `@jupyter-widgets/jupyterlab-manager` |
| `rclpy not installed` in notebook 09 appendix | Expected — ROS 2 isn't pip-installable | See [SROS2 caveat](#sros2-caveat) below |
| Notebooks render slowly under `nbconvert` | Long animation / large traces | Reduce tick counts in cells (every notebook uses *short variants*; constants are at the top) |
| Pygame "no available video device" in CI | Demo smoke without `SDL_VIDEODRIVER=dummy` | The justfile target sets it; export manually in shells |

---

## SROS2 caveat

`rclpy` and `sensor_msgs` are not on PyPI; they ship with the ROS 2
distribution (Humble or later). Install ROS 2 system-wide and source
`/opt/ros/humble/setup.bash` before launching jupyter to enable
notebook 09's SROS2 appendix.

Without ROS 2, the appendix prints an install hint and the rest of the
notebook runs fine. The marshalling layer (`envelope_to_ros_msg` /
`ros_msg_to_envelope`) is verified without rclpy via a stub
`ByteMultiArray` in `tests/test_sros2.py`.

---

## Where things live

```
notebooks/                          # this directory
  01_*.ipynb … 09_*.ipynb           # the curriculum
  README.md                         # this file

src/specter/demo/                   # orchestration helpers (build_swarm, step,
                                    # apply_attack, snapshot, RenderSnapshot)
src/specter/viz/notebook.py         # matplotlib + ipywidgets renderer module
src/specter/viz/dashboard.py        # bus-aware render helpers shared with the
                                    # ROS2 dashboard_node

docs/abc_seams.svg                  # hardware-integrator handover diagram
docs/WORKSHOP_OUTLINE.md            # the design doc behind this curriculum
docs/adr/0014-workshop-notebooks-as-audit-surface.md
                                    # the discipline (import-only, three cell
                                    # types, CI gating)

tests/eval/                         # the audit surface every claim cell cites
tests/test_workshop_accessors.py    # the 5 library accessors notebooks rely on
tests/test_viz_notebook.py          # smoke tests for every notebook helper

examples/unified_demo.py            # the live pygame demo — same orchestration
                                    # primitives the notebooks import
```

---

## Going deeper

- **[`../docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md)** — every "we resist X"
  claim, the scenario that proves it, and the measured bound. The notebooks'
  claim cells are pointers into this document.
- **[`../docs/HARDWARE_READINESS.md`](../docs/HARDWARE_READINESS.md)** — what's
  needed before sim leaves the laptop. Phase 1 (Gazebo + ROS 2) is in flight;
  Phase 2 is real TurtleBot4. Notebook 09's ABC-seam diagram is the porting spec.
- **[`../docs/RUNBOOK.md`](../docs/RUNBOOK.md)** — operator procedures for
  the deployed system (Phase 1+).
- **[`../docs/PROGRESS.md`](../docs/PROGRESS.md)** — slice-by-slice ship log;
  every commit has an entry.
- **[`../docs/adr/`](../docs/adr/)** — design decisions with status, context,
  decision, consequences. Every notebook's claim cell points to at least
  one ADR.
- **[`../tests/eval/scenarios.py`](../tests/eval/scenarios.py)** — all 12
  scripted attack scenarios. Notebook 08 is a guided tour of this file.

---

## Contributing a new notebook

If you want to add a tenth notebook (e.g. when Phase 1 Gazebo ships),
follow ADR 0014:

1. **Import-only.** No inlined library logic.
2. **Three cell types.** At least one intuition, one claim, one limit
   cell. Claim cells cite an existing `tests/eval/` test.
3. **Short variants in-cell.** Reference the full audit test by name;
   don't re-run the whole 200-tick scenario.
4. **CI gates execution.** Add the new notebook to
   `.github/workflows/ci.yml`'s `notebooks` job (it already globs
   `notebooks/*.ipynb` — just drop the file in).
5. **Update this README.** Add a row to the teaching-index table and
   any new terms to the glossary.
6. **Update the outline.** `docs/WORKSHOP_OUTLINE.md` is the design
   doc; if your notebook represents a structural change, the outline
   needs to reflect it.

If your notebook can't tie back to a measured claim, it's decoration —
either find the eval test or ship the eval test first.
