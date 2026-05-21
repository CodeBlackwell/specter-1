# Threat Model

What specter-1 measurably resists, what it doesn't, and the assumptions both
claims rest on. The eval harness is the source of truth — every "we resist X"
in this document points to a scripted scenario in `tests/eval/` and an
empirical bound (detection tick, attacker rep, false-positive count).

This document is auditable. If a claim isn't backed by a scenario, it isn't
made.

---

## System boundary

specter-1 is a per-peer trust evaluator + a signed envelope contract on top
of a message bus, designed to coexist with a SLAM stack on each robot. Trust
state is **per-evaluator** — every peer holds its own private view; reputation
gossip is trust-weighted (`GOSSIP_DISCOUNT=0.1`), and a peer's view of itself
is hard-coded to 1.0.

Phase 1 sim transport is `InProcessBus` (sync) or `LossyBus` (drop/jitter
wrapper). The SROS2-over-DDS transport (`Sros2Bus`, ADR 0011) is implemented
and passes the smoke battery within 2× InProcessBus latency; it activates
when the demo or a deployment selects `SPECTER_DEMO_BUS=sros2`. The
envelope contract is unchanged across all three buses.

---

## Assumptions

These are taken as given. If any breaks, every guarantee below breaks.

1. **Roster authority is operator-controlled.** Phase 1's `Roster` is
   immutable at swarm formation; the runtime variant
   (`identity.MutableRoster`) supports operator-driven add/remove and
   key rotation (`identity.rotation`) but treats all admissions as
   trusted operator actions. Adversarial roster mutation (e.g., an
   attacker injecting a peer) is out of scope — admissions are
   audit-logged so a deployer can detect this out of band.
2. **Honest majority of legitimate roster slots.** ≥ ⌈(N+1)/2⌉ peers behave
   honestly. The trust engine has no defense against a Byzantine majority.
3. **ECDSA P-256 + canonical-JSON envelopes are unforgeable** within the
   roster. Standard cryptographic assumption.
4. **Each honest peer's physical sensors are not spoofed.** Specifically,
   honest beacons return real entities at real positions. Sensor-spoofing
   attacks (e.g., RF replay of UWB ranges) are out of scope.
5. **Logical clock from envelope timestamps is monotone per peer.** A peer
   does not retroactively re-issue past timestamps without paying via the
   replay window.
6. **Roster keys correspond to physical robots 1:1.** I.e., one key = one
   physical body. This is the assumption hardware attestation would enforce.

Assumption 6 is the load-bearing one for Sybil resistance. Without it the
V2 self-anchored rule still holds against external attackers but not
against an attacker who has compromised one robot's keys.

---

## Adversary capabilities

Granted to the attacker:

- Operates one or more roster-resident peers.
- Can publish arbitrary signed envelopes from controlled identities.
- Can submit fake `PoseReport` and fake `Observation` payloads with valid
  signatures.
- Can inject sensor-level noise on controlled peers (`sensor_fuzz`,
  `odometry_corrupt`, `beacon_spoof`).
- Can collude with other controlled peers to coordinate timing.
- Can mint sybils — i.e., add new keypairs and roster entries
  representing identities that have no physical body in the world.
- Can replay captured envelopes (gated by replay window).

Not granted (out of scope):

- Forging signatures of un-compromised roster keys.
- Compromising the bus delivery itself (DDS-level attacks; relevant in
  Phase 3).
- Spoofing other peers' physical sensors (RF jamming, lidar dazzle,
  beacon-range injection on non-controlled peers).
- Network-level censorship (dropping or delaying messages); a degraded but
  non-adversarial radio is in scope, but a network-aware MITM is not.
- Hardware compromise that bypasses signed-envelope creation (key
  exfiltration). See "Known limits" below.

---

## Measured guarantees

Every claim links to a scripted scenario in `tests/eval/`. Detection
threshold is `final attacker rep < 0.4` from honest viewers, plus zero
false positives on honest peers. Sim runs at `dt=0.05s`; "tick N" means
`N × dt = N/20 s` of sim time.

| Attack class | Scenario | Detection tick | Attacker final rep |
|---|---|---|---|
| Honest baseline (no false positives) | `honest_swarm` | — | — |
| **Honest swarm at N ∈ {4, 16} mixed kinematics** | `test_honest_swarm_n_bots_mixed_kinematics` | — | all rep > 0.5 (ADR 0015 architectural gate) |
| Pose-lie (self-pose only) | `single_pose_liar` | — | **trust-layer no-op** (map-merger anomaly only — ADR 0015) |
| Bad-key (signature forgery rejected) | `single_bad_key` | 1 | 0.00 |
| **Foreign emitter (unknown sender, no roster entry)** | `forged_envelope` | wire-layer drops every envelope | real-agent reps stay > 0.9 — `unknown_sender` rejected at `open_envelope`, never reaches the trust evaluator |
| Range-lie (single attacker inflates outgoing ranges) | `range_lie` | ≤ baseline | < 0.4 — Tier 1 reciprocal disagreement |
| **Mid-mission range-lie (sleeper agent)** | `late_range_lie` | latency scales with accrued α: ~50 ticks at wake=5, ~350 at wake=60 | < 0.3 after detection — Tier 1 reciprocal disagreement; accrued honest history partially insulates per ADR 0015 Wave 2 |
| **Network partition + gossip** | `partition_gossip` | same-clique: direct Tier 1 (< 0.4 within tens of ticks); cross-clique: gossip-discount-bounded perturbation, settles at ~0.73 (above threshold) | partition exposes the **limit** of gossip-only reconciliation. `GOSSIP_DISCOUNT=0.1` bounds how far second-hand evidence can move reputation from a uniform prior. Direct observation is the strong detection channel; gossip is corroboration, not substitute. |
| **Phantom contact (COP)** | `cop_phantom` | tied to attacker rep collapse (Tier 1 reciprocal) | phantom dropped from COP; real `uxo-bravo` weight ~0.81 (drag from attacker's contribution); attacker rep < 0.4 — ADR 0019 |
| **Real-contact suppression (COP)** | `cop_suppress` | tied to attacker rep collapse (Tier 1 reciprocal) | real `uxo-bravo` surfaces via honest peers (weight > 0.85, reporters: {bravo, charlie, delta}); blackout fails — ADR 0019 |
| **Spatial-anchor corruption (COP)** | `cop_fob_corrupt` | tied to attacker rep collapse (Tier 1 reciprocal) | phantom hostile FOB dropped; real `fob-stalwart` surfaces via honest peers; spatial anchor protected — ADR 0019 |
| **Composite map-layer attack (COP)** | `cop_corruption_full` | tied to attacker rep collapse (Tier 1 reciprocal) | both phantoms dropped; both real items surface via honest peers; phantom injection + blackout + anchor corruption defeated by one trust-weighted filter — ADR 0019 |
| Colluder pair (symmetric mutual-range inflation) | `colluder_pair` | ≤ baseline | < 0.4 — Tier 2 MDS multilateration |
| Healed liar (rehabilitates) | `liar_then_heals` | dip visible during 20-tick lie window; recovery automatic post-heal | climbs back ≥ 0.85 via Beta decay; brief lie window does not cross detection threshold (accrued α insulates against brief perturbation) |
| Replay storm | `replay_storm` | 1 | 0.31 |
| Sensor fuzz | `sensor_fuzz` | 3 | < 0.4 — Tier 2 source attribution |
| Compromised IMU (SLAM-native) | `odometry_corrupt` | within `2 × baseline + 5` | — |
| Beacon spoof (range bias on controlled peer) | `beacon_spoof` | 3 | 0.33 — Tier 1 |
| Sybil flood (no mutual corroboration) | `sybil_flood`, `test_sybil_flood_detection_scales` | 1–3 | <0.40 at 4:3 through 100:3 (V2 self-anchored) |
| Sybil flood with mutual corroboration | `sybil_flood_mutual`, `test_sybil_flood_mutual_corroboration_detection_scales` | 2 | 0.16 → 0.28 at 4:3 through 25:3 (V2) |
| **Singleton-trusted-window lie (uncorroborated landmark from a then-trusted peer)** | `tests/test_pose_graph_singleton.py::test_singleton_cap_composes_with_reputation_collapse` | n/a — defense is per-factor weight, not reputation latency | `Ω_eff ≤ SINGLETON_INFO_SCALE · r_now · Ω_base = 0.3 × 0.01 × Ω_base = 0.003 × Ω_base`. Without ADR 0022 the weight was `r_now · Ω_base = 0.01 × Ω_base` (3.33× heavier at collapsed rep; the cap itself is a 1/0.3 ≈ 3.33× information reduction independent of reputation). Composes with stale-singleton fade to drive the weight to zero past the corroboration horizon. Reputation-tracking SC switch prior `γ_i(t) = γ_base · r_now · 10 + 0.01` provides the orthogonal mechanism for the colluder-with-residual-disagreement class. ADR 0022 §5. |

**Voting layer is range-only (ADR 0015).** As of the Range-Only PRD,
the trust evaluator votes exclusively on frame-invariant scalars
(`range_m`, plus the cohort distance matrix in Tier 2). Subject self-pose
exits the trust path entirely — it remains visible in the dashboard's
ghost-pose overlay for operators but never reaches `BetaTrustEvaluator`.
The architectural property that range-only voting holds at any N with
any mix of rotating / translation-only kinematics is gated in CI by
`tests/eval/test_scale.py` (B ∈ {4, 16} default; B ∈ {64, 200} opt-in
via `SPECTER_SCALE=1`).

**Tier 1 (reciprocal-range agreement)** runs at every cohort with
`k ≥ 1`: pairs `(observer → subject, subject → observer)` must agree
within `RANGE_RECIPROCAL_K_SIGMA · σ_combined`. Disagreement is
attributed to whichever side disagrees with the majority of other
peers' reciprocals; isolated bias produces β charges via per-peer
disagreement count.

**Tier 2 (eigenvalue-residual MDS)** runs when `k ≥ 3`: cohort
distance matrix `D` is checked for 2D-embeddability via the ratio of
non-2D to 2D eigenvalue mass. Above `MDS_EMBEDDABILITY_TAU = 0.05`,
`lying_edge_residuals(D)` localizes the violating edge by triangle
inequality. Single-source attacks (one peer in ≥2 lying edges, ≥2× any
other) and colluder-pair attacks (exactly one lying edge) are
discriminated and blamed independently.

**Sybil-resistance bounds** (the hardest claim and the most interesting):

- V0 (no defense): broke at 5:3.
- V1 (any-grantor beacon presence): defeats `sybil_flood`; broke against
  `sybil_flood_mutual` at any ratio.
- V2 (self-anchored beacon presence + per-envelope β on observations of
  non-present subjects): defeats `sybil_flood_mutual` at 4:3 through 25:3
  measured. 100:3 not asserted in CI for runtime cost (≈800k envelopes);
  trajectory at 25:3 (max sybil rep 0.28) suggests it holds further.

**Honest-peer guarantee:** zero false positives across all scenarios above.
Honest peers' rep stays ≥ 0.99 from peer perspectives.

**Holds under realistic transport loss (US-023):** the same battery
re-runs through `LossyBus(drop_prob=0.05, jitter_max_ms=10)`
(`tests/eval/test_lossy_bus.py`) — every attacker still crosses the
0.4 detection threshold within `2 × baseline + 5` ticks, with no
*persistent* honest-peer false positives in the final reputation matrix.
Honest peers can briefly dip when a corroborating envelope is dropped;
recovery is within a few ticks via decay + later observations.

**Identity-layer rejections (no rep needed):** the hardened receive
chain (`validate_timestamp` → `roster.lookup` → `RevocationList.is_revoked`
→ `AttestationProvider.is_attested` → `MutableRoster.verify_envelope`)
drops malformed envelopes at the bus boundary before they reach any
evaluator. Categorical anomalies emitted: `clock_skew_future`,
`clock_skew_past`, `unknown_sender`, `key_revoked`,
`key_revoked_post_rotation`, `unattested_key`, `bad_signature`, `replay`.
Coverage in `tests/test_identity.py`, `tests/eval/test_identity_attacks.py`,
and `tests/test_sros2.py`.

---

## Known limits

These are real attack classes the trust engine does not currently resist.
None is "we couldn't be bothered" — each is documented because the fix is
either out of Phase 1 scope or contingent on assumptions not yet validated.

### Singleton-trusted-window lie — bounded, not resolved (ADR 0022)

A peer that lies *while still trusted* about a landmark only they ever
observe leaves an uncorroborated contribution whose χ² residual stays
low (no consensus to disagree with) and whose ADR 0018 prior weight
tracks only the reporter's current reputation. ADR 0022 §§2-3 bound
the damage: the singleton confidence cap immediately scales the
factor's information matrix by `SINGLETON_INFO_SCALE = 0.3`, and the
stale-singleton fade linearly decays the cap to zero over
`T_CORROBORATE + T_FADE = 400` ticks from insertion when no second
reporter arrives. Composed with rep-collapse, the effective weight is
`Ω_eff ≤ 0.3 · r_now · Ω_base` (measured at
`test_singleton_cap_composes_with_reputation_collapse`).

**This is a bound, not an active resolution.** Vidal-Calleja et al.
ICRA 2006 (cited in ADR 0022 [R2]) propose active-perception policies
that *seek* corroboration; specter-1's defense is passive — the
singleton's weight decays whether or not the swarm ever revisits it.
Active re-observation tasking (P2 Option D from the design menu)
requires path-planning integration deferred to Phase 3 hardware. The
honest scope claim is therefore "damage from a singleton lie is
bounded by `singleton_cap × fade(Δt)`," not "singleton lies are
resolved."

### Hardware key compromise → Sybil minting (Assumption 6 violated)

A peer whose private key is exfiltrated can publish from arbitrarily many
identities, all with valid signatures. V2's self-anchoring catches them
only if self's own physical sensors don't see the fake peers — which is
true under our sensor model but contested under sensor spoofing.

**Proper fix:** hardware attestation (TPM-bound keys, Secure Enclave, or
attested boot).

**Partial fix (Phase 1, software-only):** the `AttestationProvider`
interface in `src/specter/identity/attestation.py` lets the bus boundary
reject envelopes whose signing key is not on a hardware-attested
allowlist. `AttestationRequiredFilter` composes with the roster +
revocation list; sybil keys minted on a compromised host never reach
the trust evaluator (`tests/eval/test_identity_attacks.py::
test_attestation_blocks_sybil_minting_from_compromised_robot`). Phase 1
ships `MockAttestationProvider` (allowlist of pubkeys); Phase 3+
swaps in a TPM/Secure-Enclave-backed implementation. ADR 0009 covers
the interface design and migration path.

**Residual after partial fix:** a physically present compromised peer
publishing from its own attested key. That's a Byzantine-honest-
majority problem (handled by roster sizing), not an identity problem.

**Mitigation today:** physical security + key-storage hygiene + the
attestation interface plus a real provider when hardware integration
lands. The interface is wired now so the trust path is ready when the
provider is.

### Pose-lie at the trust layer (deliberate scope clarification)

A peer that lies only about its own self-pose (`PoseReport.x/y/theta`)
without lying about beacon ranges is a **trust-layer no-op** as of
ADR 0015. The previous world-absolute voting comparing self-pose to
cross-frame medians of observer claims was architecturally broken
(every peer has a private SLAM frame). Range-only voting consumes only
frame-invariant scalars, so isolated pose lies don't influence trust.

**Where pose lies are still caught:** the map-merger
(`OccupancyMapMerger`) ray-casts each fragment from the reported pose;
a lying pose produces misaligned occupancy votes flagged at the
merge layer with `peer_weights` scaling. The trust path, by design,
no longer competes for this signal.

**Second SLAM-layer detection path (pending, ADR 0016 / SLAM_PLAN.md
Wave 4):** the forthcoming pose-graph optimizer treats reputation as a
prior on factor information (`Ω' = r · Ω`, frozen at insertion). A
peer that lies through `pose_lie` will distort the joint pose graph
under uniform weighting; reputation-weighted optimization is the
defense. Measured bound lands when `tests/eval/test_pose_lie_distortion.py`
ships in Wave 4.

**Plugged audit gap:** two attack classes added in the Range-Only PRD
exercise the range-vote layer directly — `range_lie` (single-source
range inflation, caught at Tier 1) and `colluder_pair` (symmetric
mutual-range inflation between two attackers, caught at Tier 2 MDS).

### Sensor spoofing on un-compromised peers (Assumption 4 violated)

If an attacker can inject UWB ranges, dazzle a lidar, or otherwise cause
honest peers' sensors to see entities that aren't there, the entire trust
graph rotates around the spoofed perception. The `beacon_spoof` scenario
covers a *self-induced* bias on a controlled peer; it does not cover RF
injection at an honest peer's antenna.

**Proper fix:** sensor-side authentication (signed UWB ranging,
challenge-response IMU sources). Out of scope.

### Byzantine majority

Honest-majority is a hard floor for any consensus-based trust. With > N/2
controlled peers, the cabal's median wins every cohort by definition.

**Mitigation:** roster sizing and admission policy. Not a software fix.

### Network-level censorship

A network-aware adversary that selectively drops or delays messages
between specific peer pairs can force partitions and bias cohort-close
timing. The trust engine treats this as packet loss; it does not detect
adversarial drop patterns.

**Proper fix:** out-of-band heartbeat / liveness signal, or path
diversity. Not started.

### Time-source compromise

Peers' logical-clock advancement comes from envelope timestamps. A peer
that sets its clock far in the future can advance cohort-close on others
without participating honestly. Replay window catches the trivial
replay-from-the-past case; the future-skew case is now bounded at the
application layer but not yet at the OS layer.

**Partial fix (Phase 1, application-layer):** `validate_timestamp(env_ts,
wall_ns, max_skew_ns=DEFAULT_MAX_SKEW_NS)` (US-022, ADR 0008) raises
`clock_skew_future` / `clock_skew_past` rejections for envelopes whose
`timestamp_ns` disagrees with the receiver's wall clock by more than 5s.
Wired into `Sros2Bus._apply_filters` and the unified-demo handler chain.
The K key in the demo injects +6s skew on a selected agent so the
rejection path is interactively visible.

**Residual:** the application-layer filter trusts the receiver's own
wall clock. If the receiver's clock is itself drifting (no NTP, no
chrony), the threshold becomes meaningless. The OS-layer fix —
PTP / chrony at the OS layer — is **not started** and is the load-bearing
gap before any multi-host hardware deployment. Tracked in
`HARDWARE_READINESS.md` "Transport" as a Phase 1 entry blocker.

---

## Out of scope by design

- **Privacy of robot positions** from passive observers within radio range.
  All envelopes are signed but not encrypted. The shipped `Sros2Bus`
  (ADR 0011) inherits SROS2 / DDS-Security's optional encryption — turning
  it on is a deployment-time choice, not a code change.
- **Resistance to a physically captured robot operating openly.** specter-1
  protects the *trust graph* of the surviving swarm; it makes no claim
  about the captured robot's behavior.
- **GPS / global localization integrity.** Phase 1 has no GPS; Phase 3+ may
  introduce GPS-dependent scenarios, at which point GPS spoofing would be a
  new threat class.

---

## Promotion rules

- A new attack class becomes a scenario in `tests/eval/` *before* it goes
  in this document. No claims without measurements.
- A "known limit" item that gets a scenario flips to "measured guarantees"
  when the trust engine resists it.
- An assumption that gets validated empirically (e.g., honest-majority
  via roster gating) gets demoted to a guarantee.

This document is the audit surface. If a deployer asks "does specter-1
resist X?", the answer comes from here, with a pointer to the scenario
that proves it.

## Baselines

Every published SLAM-layer robust-PGO alternative cited in ADR 0016 has a
measured head-to-head comparison in `docs/BASELINES.md` and
`tests/eval/test_baselines.py`: GNC (Yang 2020), DCS (Agarwal 2013),
**Switchable Constraints (Sünderhauf 2012, added 2026-05-17)**, PCM
(Mangelson 2018), Moroncelli token-admission (ANTS 2024). The
architectural decoupling claim (exogenous-prior DCS sourced from a
separate evidence channel than the SLAM residuals) is the load-bearing
differentiator vs. residual-only mechanisms (GNC / DCS / SC) — those are
all structurally blind to geometrically-consistent coordinated lies, which
specter-1's range-only voting (ADR 0015) and trust ↔ SLAM bidirectional
coupling (ADR 0020) catch through independent evidence.

**Coordinated-colluder architectural gate (added 2026-05-17).** Three
tests in `tests/eval/test_baselines.py` empirically gate the decoupling
claim, replacing argument-from-design with measured bounds:

| Claim | Test | Measured |
|---|---|---|
| Residual-only modes fail on geometrically-consistent colluders | `test_baseline_residual_only_modes_fail_on_coordinated_colluder` | gnc / dcs / switchable err = 1.0 m at the LS midpoint (2 honest @ 5m vs 2 colluders @ 7m, uniform σ, seeded at midpoint to remove seed bias) |
| Exogenous mode + Tier 2 rep recovers truth | `test_baseline_exogenous_recovers_coordinated_colluder_with_tier2_rep` | err = 0.0 m with `rep_for_colluders = 0.1` |
| The win is the channel, not the mode (control) | `test_baseline_exogenous_without_tier2_rep_also_fails_on_colluder` | exogenous mode WITHOUT Tier 2 rep also err = 1.0 m |

Together these prove that no choice of γ (DCS), μ-schedule (GNC), or φ
(SC) can break a residual symmetry that is symmetric by construction —
only evidence sourced outside the residual stream can. ADR 0015 Tier 2
MDS embeddability is that evidence channel.
