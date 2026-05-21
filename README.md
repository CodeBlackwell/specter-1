# SPECTER-1

**Byzantine-resilient cooperative SLAM, with an audit trail.**

A swarm of robots can map a building together. But what happens when one of them
lies about where it is? Or fakes a hundred peers to vote a real robot off the
island? Or replays yesterday's scans to poison today's map?

SPECTER-1 is a working demonstrator — and a 9-notebook teaching curriculum —
that shows how to detect and survive those attacks. Every claim it makes
("we resist Sybil flooding up to 4:3") is backed by a scripted scenario in
`tests/eval/` and a measured bound. No marketing adjectives; just numbers
that fail CI when they regress.

---

## Table of contents

- [Why this project exists](#why-this-project-exists)
- [What's unique](#whats-unique)
- [Business value](#business-value)
- [Teaching value](#teaching-value)
- [How range-only trust voting works](#how-range-only-trust-voting-works)
- [Status](#status)
- [Quickstart](#quickstart)
- [The 9-notebook workshop](#the-9-notebook-workshop)
- [Live demo controls](#live-demo-controls)
- [Authoring scenarios](#authoring-scenarios)
- [Repo layout](#repo-layout)
- [Glossary](#glossary)
- [Going deeper](#going-deeper)

---

## Why this project exists

Robotics swarms have no widely-deployed trust layer. The cooperative-SLAM
literature assumes peers are honest; the security literature assumes a network
service, not a noisy radio between two robots that disagree about where the
wall is. A single compromised TurtleBot can poison a warehouse map, and the
honest robots will happily follow it.

SPECTER-1 proves — with measurements — that you can compose three things into a
working defense:

1. **ECDSA-signed envelopes** (catch forged messages, replay, key rotation
   violations).
2. **Per-peer Beta(α, β) reputation** with 10-second exponential decay (forget
   old evidence; weight observers by behavior, not identity).
3. **Two-tier range-only voting** (ADR 0015) — frame-invariant geometry that
   doesn't depend on any shared coordinate system. Tier 1 checks reciprocal
   beacon ranges; Tier 2 runs eigenvalue-residual MDS multilateration over the
   cohort distance matrix when ≥ 3 observers are available. Catches peers
   that lie about their distance to others, including symmetric colluder pairs.

The hardware target is locked: ROS 2 Humble + Gazebo + TurtleBot4 +
Crazyflie+UWB (ADR 0006). The Phase 1 entry kit has already shipped — sensor
adapters, agent + dashboard ROS 2 nodes, signed-roster bootstrap, systemd
units, chrony NTP config, and a multiprocess battery EXIT test that runs
real DDS once you install rclpy.

---

## What's unique

**Audit-grade by construction.** Every "we resist X" claim in
`docs/THREAT_MODEL.md` points to a named scenario in `tests/eval/` and an
empirical detection bound. The rule is enforced socially and in CI:
**no claims without measurements.**

**Eval-first methodology.** When we built scan-match SLAM, we wrote the
*negative test* first — locking in dead-reckoning's 12.95 m drift as a
regression guard before any optimization. The improved version had to clear
that bar, in writing, on every commit.

**The V2 self-anchored beacon defense.** Sybils have no body. So instead of
trusting *any* beacon corroboration, the evaluator counts only beacons its
*own* sensor recorded. Mutual-corroboration sybil cabals — which beat naive
defenses trivially — collapse to reputation ≈ 0.16 at 4:3 ratios and stay
detectable up to 25:3.

**Range-only voting that survives private SLAM frames** (ADR 0015). Every
peer in a real swarm has its own privately-drifting coordinate system. Voting
on "where peer X is" across those frames compares numbers from different
origins — and breaks. SPECTER-1 votes only on `range_m`, which is
frame-invariant by physics: a beacon return measures distance, not position.
Tier 1 checks reciprocal-range agreement (every honest pair must agree on
their separation within ~3σ); Tier 2 runs eigenvalue-residual MDS over the
cohort distance matrix to catch symmetric collusion that Tier 1 cannot. The
architectural property — *"works at any N with any mix of rotating /
translation-only kinematics"* — is gated in CI by `tests/eval/test_scale.py`.

**A workshop you can run in 5 minutes.** Nine Jupyter notebooks decompose
the live demo into three cell types per notebook: *intuition* (build the
mental model), *claim* (cite the audit test that proves it), *limit*
(name the residual gap honestly). No inlined math. No drift. CI re-executes
every notebook on every PR — if the library changes shape, the notebooks
fail the build.

**Pure-Python first, then DDS, then radio.** Phase 1 is laptop-scale sim
with no Docker. Phase 3 swaps `InProcessBus` for `Sros2Bus` over real DDS
with signed-node enclaves — and the trust + SLAM stack doesn't change. The
ABC seams (`src/specter/interfaces.py`) are the hardware-integration
contract; the porting diagram is `docs/abc_seams.svg`.

---

## Business value

If you operate or insure a fleet of autonomous robots, this is a reference
design for the trust layer you don't have yet:

- **Warehouse and logistics swarms** — single compromised AGV today can
  rewrite the cost map for every peer. SPECTER-1's reputation + range-only
  two-tier voting (ADR 0015) localizes the lie to one node within tens of ticks.
- **Search-and-rescue and infrastructure-inspection drones** — operating
  on contested or jammed RF means peers will *appear* malicious from
  packet loss alone. The eval battery already runs every scenario through
  `LossyBus(drop=5%, jitter=10ms)` and asserts detection holds within
  `2× baseline + 5` ticks.
- **Safety-critical multi-agent systems** under regulatory review — a
  threat model that lists adversary capabilities, measured guarantees,
  known limits, and out-of-scope items is the artifact regulators ask
  for. We ship it: `docs/THREAT_MODEL.md`.
- **Security audits** — the eval harness *is* the audit. New attacks
  become new scenarios; new defenses must show their detection bound
  in the same harness or the PR doesn't merge.

The project is also a hiring/competence demonstrator. It shows discipline
across four hard surfaces — cryptography, distributed-trust math, SLAM,
and ROS 2 deployment — without faking any of them. 484 tests passing
(+ 28 skipped, 6 xfailed), ruff + mypy clean, every design choice
traceable to an ADR.

---

## Teaching value

SPECTER-1 doubles as a senior-engineer-grade curriculum on cooperative
robotics security. Most "secure robotics" content is one of:

- A lecture deck with no running code, or
- A research paper whose code doesn't compile, or
- A "tutorial" that hand-rolls toy versions of the very systems it claims
  to teach.

The workshop is none of those. It is the *real* demonstrator, sliced into
9 layers, executed by `nbconvert --execute` in CI:

1. **`01_signed_envelopes_and_bus`** — ECDSA + nonce replay window + the
   five categorized rejection reasons.
2. **`02_identity_lifecycle`** — mutable roster, key rotation, revocation,
   mock attestation (real TPM is Phase 4 honest).
3. **`03_beta_reputation_and_decay`** — slide α and β interactively,
   watch the prior become a posterior, then watch the 10-second
   half-life pull it back.
4. **`04_voting_triangulation_gossip`** — cohort-close range voting
   (Tier 1 reciprocal-range; Tier 2 MDS multilateration when `k ≥ 3`),
   trust-weighted gossip. ADR 0015 records the architectural decision.
5. **`05_sim_and_sensor_realism`** — lidar dropouts, IMU bias drift, UWB
   beacons with NLOS multipath. The sim is *budgeted*, not aspirational
   (ADR 0005).
6. **`06_slam_dead_reckoning_to_scan_match`** — the negative test, then
   the radial-flow LSQ that beats it 17×.
7. **`07_cooperative_map_merge`** — trust-weighted occupancy fusion.
   Crank one peer's weight to 0.1 and watch their lies stop poisoning
   the merged map.
8. **`08_attack_battery_tour`** — small-multiples grid of all 12
   scripted attacks; rep(t) per scenario.
9. **`09_full_byzantine_swarm`** — composition. Then a SROS2 transport-swap
   appendix that runs over real DDS when `rclpy` is present, and
   degrades gracefully when it isn't.

Each notebook ends with a *measured claim cell* citing the audit test
that proves what you just learned. You can stop after any notebook and
still have a verified subclaim. The full curriculum is < 5 min of
laptop wall-clock and < 30 min of reading.

See [`notebooks/README.md`](notebooks/README.md) for the full curriculum index
and audience-specific reading paths (hardware integrator, reviewer, security
engineer, first-time visitor).

---

## How range-only trust voting works

The trust evaluator (`src/specter/trust/evaluator.py`) ingests
`Observation(observer_id, subject_id, range_m, bearing_rad, timestamp_ns)`
envelopes and produces a per-peer Beta(α, β) reputation. The voting layer
runs in two tiers, both consuming **range only**. Self-pose never enters the
trust path (ADR 0015 — see [`docs/adr/0015-range-only-trust-voting.md`](docs/adr/0015-range-only-trust-voting.md)).

### Why range, not position

Every peer in a real swarm runs its own SLAM, in its own coordinate frame,
that drifts independently. A peer's `(x, y, θ)` is meaningful only inside
that peer's private frame; comparing across peers' frames is comparing
numbers from different origins.

`range_m`, in contrast, is **frame-invariant by physics**: a UWB beacon
measures the distance between two transceivers regardless of either side's
coordinate system. Two honest peers ranging each other will agree on
`r(A→B) ≈ r(B→A)` up to sensor noise — and that's the entire foundation
of the voting layer.

### Tier 1 — reciprocal-range agreement

At every cohort close, for each pair `(observer O, subject S)`:

```
| r(O→S) − r(S→O) | ≤ RANGE_RECIPROCAL_K_SIGMA · σ_combined
```

with `σ_combined = sqrt(2·σ_beacon² + σ_NLOS²) ≈ 0.165 m` and
`RANGE_RECIPROCAL_K_SIGMA = 3.0` (≈ 99.7% of honest noise).

- **Frame-invariant** — depends on nothing outside the two transceivers.
- **`O(k)` per cohort** — single linear pass over reciprocal pairs.
- **Fires at any `k ≥ 1`** — even two-agent swarms get coverage.
- **Source attribution** — when a reciprocal disagrees, the side
  disagreeing with the *majority* of other peers' reciprocals earns β.

Catches: `range_lie` (single-source range inflation), `beacon_spoof`,
single-source `sensor_fuzz` bias.

### Tier 2 — eigenvalue-residual MDS multilateration

When `k ≥ MIN_K_FOR_TIER2 = 3`, the cohort builds a symmetric distance
matrix `D` from all available pairwise ranges. Classical Torgerson MDS
double-centres `D²` and eigendecomposes `B = −½·J·D²·J`. For an honest
2D-embeddable geometry, eigenvalue mass concentrates in the top 2 modes;
liars push mass into mode 3+:

```
embeddability_score(D) = sum(|λ_k|, k ≥ 2) / sum(|λ_0|, |λ_1|)
```

Above `MDS_EMBEDDABILITY_TAU = 0.05`, `lying_edge_residuals(D)`
identifies which edge of the distance matrix violates the triangle
inequality. Two attack signatures discriminated:

| Signature | Detection |
|---|---|
| One peer appears in **≥ 2 lying edges, ≥ 2× any other peer's count** | single-source attacker; β charged to that peer |
| **Exactly one lying edge** with both endpoints exceeding threshold | colluder pair; β charged to both endpoints |

β is capped at `MDS_BETA_CAP = 1.0` per cohort to bound single-cohort
damage. Multi-tick accumulation through the existing 10-second
exponential-decay machinery converts noisy per-cohort signal into
detection.

Catches: `colluder_pair` (symmetric mutual-range inflation that Tier 1
sees as agreement), `sensor_fuzz` source attribution, persistent
geometric inconsistency under `odometry_corrupt`.

### How the tiers compose

Both tiers run on every closed cohort with `k ≥ 1` / `k ≥ 3`
respectively. Tier 2 runs first to claim outliers; Tier 1 then handles
pairs not already flagged. Three regimes:

1. **Tier 2 found outliers** — Tier 1 skips those pairs (avoid double-charge).
2. **Tier 2 ran, no outliers** — Tier 1 charges β with **source attribution**
   (majority-of-reciprocals vote picks the side to blame).
3. **Tier 2 didn't run (`k < 3`)** — Tier 1 charges β symmetrically when
   a pair disagrees (no majority to attribute against).

### Composition with V2 self-anchored beacon defense (sybils)

Sybils are filtered **before** Tier 1 or Tier 2 fires. The V2 rule
(`evaluator._has_presence`) only counts the evaluator's *own* beacons as
presence grants — sybils have no physical body, so honest peers never
beacon them, so cabal-internal mutual corroboration is zero-weighted at
the voting layer. Range-only voting handles real-bot attacks; V2 handles
the sybil ceiling. Measured sybil resistance: 4:3 (no mutual
corroboration) through 25:3 (mutual corroboration), with detection at
4:3 → max sybil rep 0.16, 25:3 → max sybil rep 0.28.

### Audit gates

- `tests/eval/test_attack_battery.py` — `range_lie`, `colluder_pair`,
  `sensor_fuzz`, `beacon_spoof`, `odometry_corrupt`, `replay_storm`,
  `sybil_flood`, `sybil_flood_mutual` all detected within
  `2 × InProcessBus baseline + 5` ticks.
- `tests/eval/test_scale.py` — **architectural property**: honest swarm
  at procedural N ∈ {4, 16} mixed kinematics (half rotating, half
  translation-only) holds `min(rep across all viewer→peer pairs) > 0.5`.
  `B ∈ {64, 200}` available via `SPECTER_SCALE=1`.
- `tests/test_trust_mds.py` — MDS module unit tests.
- `tests/eval/test_sybil_scale.py` — V2 composition.

### What's *out* of the trust path

- `Observation.bearing_rad` — published for the simulator's sybil
  geometry and visualization, but **not consumed by the trust engine**.
- `PoseReport.x, y, theta` — kept in `snapshot.py` for the ghost-pose
  overlay only. The map merger (`OccupancyMapMerger`, ADR 0010) still
  ray-casts from each peer's reported pose; that's where a `pose_lie`
  attack now surfaces as a misaligned occupancy fragment.
- SLAM drift — silently absorbed. The corridor demo's pre-ADR-0015
  reputation collapse on honest rotating peers (bravo, delta → 0.23)
  is regression-gated by `test_scale.py`.

---

## Status

Phase 0 (interface ABCs) complete. Phase 1 (pure-Python sim + trust engine
+ SLAM) at ~75% — trust resilience ~95% done, cooperative SLAM ~65% with
scan-match + occupancy merger shipped, MapMerger consensus engine ABC-only.
Phase 1 hardware entry kit landed (sensor adapters, agent + dashboard
nodes, launch + systemd + chrony, RUNBOOK v0). Phase 3 SROS2 transport
ready; rclpy optional.

484 tests passing (+ 28 skipped under absent rclpy + opt-in gates,
6 xfailed). ruff + mypy clean
on `src/specter/`. CI gates pytest, lint, demo smoke, and notebook
execution on every PR.

See `docs/PROGRESS.md` for the slice-by-slice ship log.

---

## Quickstart

```bash
just setup
just test                                       # 484 tests
just sim                                        # headless, default scenario
just viz                                        # pygame window
just sim scenarios/four_agents_corridor.yaml
just viz scenarios/four_agents_corridor.yaml
just chat                                       # signed-message CLI demo
just demo                                       # unified sim + signed bus + trust engine
just workshop                                   # launch JupyterLab on notebooks/
just workshop-check                             # nbconvert --execute every notebook
```

---

## The 9-notebook workshop

```bash
uv sync --all-extras
uv run jupyter lab notebooks/
```

Three commands, no Docker. The `[workshop]` extra brings in `jupyterlab`,
`matplotlib`, `ipywidgets`, `scipy`, `nbclient`. See
[`notebooks/README.md`](notebooks/README.md) for the full guide.

---

## Live demo controls

Viewer keys: SPACE pause, N single-step, S screenshot, Q quit.

Demo keys: SPACE pause, N step, X swap-key, L pose-lie, H heal, R revoke,
T rotate key, Y mint sybil, A toggle attestation, K toggle clock skew,
J toggle JSONL telemetry, V cycle viewer, Q quit.

Each visible trust state — honest, pose-liar, crypto-compromised, healed,
revoked, sybil — has a distinct visual signature in the reputation panel.
The ghost-pose triangle shows real-time SLAM-vs-truth drift; the merged
occupancy overlay shows cooperative map fusion across the swarm.

---

## Authoring scenarios

Scenarios are YAML, no Python required. Drop a new file in `scenarios/`:

```yaml
world: { width: 10, height: 10 }
walls: [[5, 0, 5, 5]]
agents:
  - { id: alpha, x: 2, y: 2, theta: 0,    vx:  0.3, omega:  0.1 }
  - { id: bravo, x: 8, y: 8, theta: 3.14, vx: -0.2, omega: -0.1 }
seed: 42
duration: 400
```

---

## Repo layout

```
src/specter/         core package (interfaces, sim, trust, consensus, slam)
src/specter/proto/   wire format schemas
src/specter/trust/   evaluator + mds.py (Tier 1 + Tier 2 voting, ADR 0015)
src/specter/identity/ mutable roster, rotation, revocation, attestation
src/specter/transport/ InProcessBus, LossyBus, Sros2Bus, per-topic QoS
src/specter/ros2/    Phase 1 entry kit — agent_node, dashboard_node, adapters
src/specter/viz/     pygame live viewer + notebook matplotlib helpers
src/specter/demo/    orchestration primitives shared by demo + notebooks
docs/                threat model, hardware readiness, ADRs, runbook, progress
notebooks/           9-notebook workshop curriculum (ADR 0014)
scenarios/           declarative YAML worlds + agents
tests/               pytest suite (260 tests; eval/ is the audit surface)
tests/eval/          14 scripted attack scenarios — the audit surface
examples/            runnable entrypoints (unified_demo, ros2_demo, chat)
launch/              ROS 2 launch files for single robot + 4-robot swarm
infra/               chrony.conf + systemd units for production deploy
tools/               operator scripts (gen_roster.py)
```

---

## Glossary

Headline definitions. The full glossary — every term, variable, constant, and
attack name with its file and default value — lives in
[`notebooks/README.md`](notebooks/README.md#glossary--terms-variables-constants).

| Term | One-line meaning | Value / default |
|---|---|---|
| **Envelope** | Signed wire-format wrapper carrying `(kind, payload, sender, nonce, timestamp, signature)`. ECDSA over NIST P-256 | — |
| **Replay window** | Per-sender strict-monotonic nonce gate; rejects anything not strictly newer | per-sender FIFO |
| **Roster** | Map from `agent_id` → `pubkey`. `MutableRoster` adds rotation history + audit log | — |
| **Attestation** | TPM/Secure-Enclave allowlist gate at the bus boundary; mock ships, real impl is Phase 4 (ADR 0009) | mock allowlist |
| **Beta(α, β)** | Per-peer reputation distribution. `reputation = α / (α + β)` | prior `(1, 1)` |
| **`ACCEPT_ALPHA`** | α earned for a valid signature alone — down-weighted so behavior dominates | `0.1` |
| **Decay half-life** | Exponential decay of evidence above prior toward `(1, 1)` (ADR 0013) | 10 s |
| **`GOSSIP_DISCOUNT`** | Weight applied to incoming reputation gossip from a peer | `0.1` |
| **Cohort-close voting** | Range vote fires only when a *later-timestamp* envelope arrives — fixes 2-of-N colluder bug | — |
| **Tier 1 (reciprocal range)** | `\|r(O→S) − r(S→O)\| ≤ k·σ` pairwise check at every cohort; frame-invariant; source-attributes single-side disagreement (ADR 0015) | `RANGE_RECIPROCAL_K_SIGMA = 3.0` |
| **Tier 2 (MDS multilateration)** | Eigenvalue-residual classical MDS on the cohort distance matrix when `k ≥ 3`; triangle-inequality lying-edge residuals localize colluder pairs (ADR 0015) | `MDS_EMBEDDABILITY_TAU = 0.05` |
| **`range_m`, `bearing_rad`** | Frame-invariant beacon scalars — the only signal the trust engine consumes (ADR 0015) | — |
| **V2 self-anchored beacon** | Only the evaluator's *own* beacon Observations grant presence credit. Defeats mutual-corroboration sybil cabals | — |
| **Detection threshold** | Reputation below which a peer is flagged Byzantine | `0.4` |
| **Sybil ceiling** | Max Sybil:honest ratio at which detection holds (`tests/eval/test_sybil_scale.py`) | `4:3` |
| **`DeadReckoningSlam`** | Theta from gyro, xy from held velocity. Negative-test baseline (ADR 0004) | 12.95 m drift @ 200 t |
| **`ScanMatchSlam`** | Radial-flow LSQ velocity from consecutive lidar scans; theta still gyro-driven (ADR 0007). Default in eval + demo | `< 1.5 m` @ 200 t, `< 2.0 m` @ 400 t |
| **`OccupancyMapMerger`** | Trust-weighted free-vote / occupied-vote ray-casting fusion across peer fragments (ADR 0010) | resolution `0.2 m` |
| **Loop closure detection** | True iff ≥ 50% of valid scan endpoints land within `0.3 m` of an occupied cell. Detection signal only — pose correction is out of scope | `0.3 m`, ≥ 50% |
| **`InProcessBus`** | In-process synchronous bus; default in tests + demo | — |
| **`LossyBus`** | Wrapper adding seeded drop / jitter / reorder for radio-realism evals (ADR 0008) | — |
| **`Sros2Bus`** | Secure ROS 2 bus over real DDS with signed-node enclaves (ADR 0011). rclpy optional | — |
| **`DEFAULT_MAX_SKEW_NS`** | Wall-clock skew filter — envelopes outside this window rejected | 5 s (ADR 0008) |
| **ABC seam** | Subclass-here boundary the hardware integrator overrides for TurtleBot4 / Crazyflie+UWB. See `docs/abc_seams.svg` | — |
| **Battery detection budget** | Detection must hold within `2 × InProcessBus baseline + 5` ticks under any transport | — |
| **Attack kinds** | `swap_key`, `pose_lie` (map-merger anomaly only — ADR 0015), `range_lie` (Tier 1), `colluder_pair` (Tier 2), `sensor_fuzz`, `replay_storm`, `odometry_corrupt`, `beacon_spoof`, `heal`, plus `SybilSpec` for forged identities (`sybil_flood`, `sybil_flood_mutual`) | — |
| **Rejection categories** | `bad_signature`, `unknown_sender`, `replay`, `version_mismatch`, `clock_skew_future` / `clock_skew_past`, `unattested_key`, `key_revoked`, `key_revoked_post_rotation` | — |

---

## Going deeper

- **[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)** — every resistance
  claim, the scenario that proves it, and the measured bound. The
  notebooks' claim cells are pointers into this document.
- **[`docs/HARDWARE_READINESS.md`](docs/HARDWARE_READINESS.md)** — what's
  needed before sim leaves the laptop. Phased: Gazebo → TurtleBot4 single
  → small swarm → Crazyflie+UWB. Entry/exit criteria are measurable.
- **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** — operator procedures: bring-up,
  the 12 anomaly categories with first-check + response, partition
  response, time-sync loss, key rotation/revocation.
- **[`docs/PROGRESS.md`](docs/PROGRESS.md)** — slice-by-slice ship log.
  Every commit has an entry.
- **[`docs/adr/`](docs/adr/)** — 14 ADRs covering every non-obvious
  design call: pure-Python first, ECDSA + Beta, canonical JSON →
  protobuf, scan-match radial flow, time-sync skew, attestation
  interface, occupancy voting, SROS2 transport, per-topic QoS, decay
  window calibration, workshop notebooks as audit surface.
- **[`docs/WORKSHOP_OUTLINE.md`](docs/WORKSHOP_OUTLINE.md)** — the design
  doc behind the curriculum.
- **[`tests/eval/scenarios.py`](tests/eval/scenarios.py)** — all 12
  scripted attack scenarios. Notebook 08 is a guided tour.
