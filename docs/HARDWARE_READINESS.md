# Hardware Readiness

What's needed before specter-1 leaves simulation. A working punch list — items get
struck-through as they ship, decisions promote up to ADRs, durable risks promote
to `THREAT_MODEL.md`.

The technical half (SLAM stack, transport) is partially tracked in
`docs/PROGRESS.md` and the ADRs; this document consolidates that with the
operational, safety, and observability gaps that aren't tracked anywhere yet.

---

## Bottom line

Trust engine: production-ready in simulation against the measured threat
battery. Cooperative-SLAM half: scan-match SLAM + trust-weighted MapMerger
+ loop-closure detection — **landed end-to-end in sim**. Transport: SROS2
over real DDS shipped (`Sros2Bus`, ADR 0011), runs the same battery within
2× InProcessBus latency. Identity hardening: runtime roster, key rotation,
revocation list, mock attestation provider — all live with eval coverage.
Operational posture: still mostly absent — JSONL telemetry sink exists but
no ROS2 launch files, no per-robot deployment shape, no runbook, no
calibration procedures.

Minimum honest path before any **first hardware run** (Phase 1 = Gazebo +
real DDS, single robot): sensor topic adapters → per-robot ROS2 node →
roster bootstrap procedure → OS-layer time sync (chrony/PTP) → operator
dashboard node → launch files + runbook v0. Estimated one substantial
slice covers the deployment scaffolding now that the application stack
is hardware-ready in shape.

---

## Phased deployment path

| Phase | Target | Entry criteria | Exit criteria |
|---|---|---|---|
| 0 | Sim only (current) | — | Trust battery passes; SLAM drift bounded; ADR 0006 platform locked |
| 1 | **Gazebo + ROS2** (sim physics, real DDS) | Scan-match + MapMerger + SROS2 swap shipped | ~~Same battery passes over real DDS; no behavior change vs InProcessBus~~ — entry kit shipped (Wave 0–3, commit acfd7c1+); EXIT criterion `tests/integration/test_battery_multiprocess.py` ready to run with rclpy installed |
| 2 | **TurtleBot4 single robot** (real Linux, mocked peers) | Phase 1 done; ROS2 launch files; calibration procedure; runbook v0 | 200-tick honest run on real h/w with no false-positives; trust state matches Gazebo within tuning band |
| 3 | **TurtleBot4 small swarm (2-3)** | Phase 2 done; multi-robot launch; radio QoS chosen | Battery's first 4 scenarios (honest, pose-liar, bad-key, replay) pass over real radio in a controlled space |
| 4 | **Crazyflie + UWB swarm** | Phase 3 done; C/Rust port of evaluator OR microROS-only role; UWB calibration | TBD (different platform; criteria set when phase 3 ships) |

Each phase exit criterion has to be *measurable*. "Looks like it works" is not an exit.

---

## Cross-cutting gaps

### Cooperative SLAM

| Item | Status | Tracked in |
|---|---|---|
| Scan-match SLAM | ~~Deferred~~ → **Done (ADR 0007, `e4cb290`+scan-match)** | ADR 0007 |
| MapMerger (trust-weighted) | ~~ABC only~~ → **Done (ADR 0010, US-010 → US-012)** — `OccupancyMapMerger` ray-casts per-peer fragments with `peer_weights` scaling; honest 4-peer recall ≥ 90% / precision ≥ 95%; adversarial 4×4-pose liar held at recall ≥ 85% / precision ≥ 90% with trust weights vs. <70% precision uniform | ADR 0010 |
| Loop closure / occupancy grid | ~~Not started~~ → **Done (US-013)** — `detect_loop_closure(scan, pose, merged_map)` returns True when ≥ 50% of valid scan endpoints land within threshold of an occupied cell. No automatic pose correction (deliberate; downstream wires it). | ADR 0010 |
| Honest drift bound at >200 ticks | Done — 0.50 m at 200t, 0.97 m at 400t | `tests/eval/test_slam_drift.py` |

The cooperative-SLAM half is **complete in sim**. Headline is honest.

### Transport

| Item | Status | Tracked in |
|---|---|---|
| SROS2 swap over DDS | ~~Not started~~ → **Done (ADR 0011, US-040 → US-043)** | ADR 0011 |
| `LossyBus` wrapper (drop / jitter) | ~~Deferred~~ → **Done (US-020)** — wraps any `MessageBus` with seeded-RNG drop/jitter/reorder; logical-clock heap with sequence tiebreaker yields deterministic flush; battery passes at drop=5% jitter=10ms | — |
| Async sensor cadences (lidar 10 Hz, IMU 200 Hz, UWB ~10 Hz) | ~~Deferred~~ → **Done (US-021)** — `cadence_dispatch(sim, callbacks, n_ticks)` plus inline stride logic in `examples/unified_demo.py` (opt-in via `SPECTER_DEMO_CADENCES=1`) | — |
| QoS profile choice (best-effort vs reliable per topic) | ~~Open~~ → **Done (ADR 0012, US-050)**: per-topic `qos_for_topic()` table; `Sros2Bus(qos_for_topic=...)` opt-in | ADR 0012 |
| Wall-clock skew sanity (envelope ts vs receiver clock) | ~~Not addressed~~ → **Done (ADR 0008, US-022)** — `validate_timestamp(env_ts, wall_ns, max_skew_ns=5_000_000_000)` raises `clock_skew_future`/`clock_skew_past`; wired into `Sros2Bus._apply_filters` and the unified-demo handler chain | ADR 0008 |
| **OS-layer time sync (PTP / chrony)** | **Not started** — required to keep peers within `validate_timestamp`'s 5s threshold across a multi-host deployment. Phase 1 entry blocker. | None |
| Decay-window / cohort-close calibration vs real radio jitter | Evidence in `tests/eval/test_calibration.py` (ADR 0013) — inflection at ~100 ms jitter; tuning still pending real-radio measurements | ADR 0013 |

### Identity & roster

| Item | Status | Tracked in |
|---|---|---|
| **Hardware attestation interface + mock impl** | ~~Not started~~ → **Done (ADR 0009, US-033)** — `AttestationProvider` ABC + `MockAttestationProvider(allowlist)`; `AttestationRequiredFilter` composes with revocation + roster; eval `test_attestation_blocks_sybil_minting_from_compromised_robot`. **Real TPM/SE-backed provider** still pending Phase 4 hardware integration. | ADR 0009 |
| Roster updates at runtime (peer join/leave) | ~~Not started~~ → **Done (US-030)** — `MutableRoster` wraps `Roster` with timestamped `add_peer`/`remove_peer`/`lookup` + append-only audit log. Drop-in `roster.lookup(...)` compatibility. | — |
| Key rotation | ~~Not started~~ → **Done (US-031)** — `KeyRotationAnnouncement` signed by old key + `verify_rotation` + `apply_rotation`; `MutableRoster.verify_envelope` distinguishes `key_revoked_post_rotation` from generic `bad_signature` (forensic signal). | — |
| Revocation list for known-bad keys | ~~Not started~~ → **Done (US-032)** — `RevocationList.revoke(pubkey, t_ns)` / `is_revoked` (forward-only); `filter_envelope` helper composes at the bus boundary. Eval scenario: revoke compromised peer mid-run, post-T envelopes rejected. | — |

The Sybil ceiling has a software-only partial fix today (`MockAttestationProvider`
allowlist rejects sybil keys minted on a compromised host). The residual is a
TPM/Secure-Enclave-backed `AttestationProvider` implementation — Phase 4 work,
gated on hardware platform selection.

### Kinematics & motion model

| Item | Status |
|---|---|
| Agent heading (`theta`) | **Deferred — holonomic sim**. Sim agents translate via `(vx, vy)` and every planner commands `omega: 0`, so stored heading stays at 0 rad forever. Workshop UI synthesises a display-only heading via `atan2(vy, vx)` (`ui/packages/app/src/sim/swarmHints.ts`). On hardware (TurtleBot4 differential drive, Crazyflie quad yaw) heading is a real state — odometry, IMU yaw, and bearing observations all reference it. Resolved on hardware; not worth fixing the sim. |
| Differential-drive / yaw kinematics in planners | Deferred to Phase 3 — Gazebo is the bridge. No sim-side honest yaw integration is planned. |

### Safety & failure modes

| Item | Status |
|---|---|
| Watchdog: peer-silence timeout behavior | Undefined |
| Fail-safe: self in minority view of swarm | Undefined |
| Graceful degradation: peer leave/rejoin, intermittent radio | Undefined |
| Behavior when own time source loses sync | Undefined |
| Partition recovery: split-brain reconciliation | Undefined |

These are not "missing features" — they're missing *decisions*. A real
deployment forces an answer for each.

### Performance & edge

| Item | Status |
|---|---|
| Python evaluator — TurtleBot4 (Linux) | Likely fine; **not measured on target hardware** — Phase 1 entry should run `tests/eval/test_profiling.py` on TurtleBot4 |
| Python evaluator — Crazyflie (Cortex-M4 / 192 KB RAM) | Won't fit; needs C/Rust port or microROS-only role (Phase 4) |
| Profiling at scale | Done in sim (US-004) — `test_profiling.py` measures n=4: 156μs/tick, n=10: 785μs/tick, n=25: 3.9ms/tick (sub-quadratic, 25× ratio at N=25 vs N=4). Target-hardware profile pending. |
| Telemetry sink (in-memory `ListTelemetry`) | ~~Not field-deployable~~ → **`JsonlTelemetrySink`** (US-002) — append-mode, parent-dir auto-created, robust to malformed payloads. Suitable for short-run capture; rosbag-shaped sink + central observability stack still pending |

### Observability

| Item | Status |
|---|---|
| Persistent telemetry sink | ~~Not started~~ → **`JsonlTelemetrySink`** (US-002). Rosbag-shaped sink for ROS2 deployment still pending |
| Structured anomaly schema (vs ad-hoc dict) | ~~Open~~ → **Done (US-001)** — frozen `AnomalyEvent(category, sender_id, nonce, timestamp_ns, detail)` in `src/specter/telemetry/schema.py`; `from_emit_kwargs` parses live emit payloads. `StreamTelemetry` shim in `examples/unified_demo.py` shows the live consumption pattern |
| Reputation history tracing | ~~Demo-only~~ → **`ReputationTrace`** (US-003) — per-peer ring buffer (`maxlen=10000`), drives the demo sparkline. Library-grade; reusable in any node |
| Field-grade trust dashboard | **Demo-only** — pygame `unified_demo.py` is single-process. Hardware needs an operator dashboard ROS2 node subscribing to gossip + anomaly stream + merged-grid topics. Not started |
| Categorized anomaly stream (color-bucketed live view) | **Demo-only** — `draw_anomaly_panel` renders the last 8 typed `AnomalyEvent`s. Translates straightforwardly to a dashboard node |

### Operational artifacts not yet written

Phase 1 entry kit landed (commit acfd7c1+ on `main`). Remaining items
are Phase 2+ deliverables:

- ~~**ROS2 launch files** — single-robot bring-up, multi-robot Gazebo~~ → `launch/single_robot.launch.py`, `launch/swarm_gazebo.launch.py`
- ~~**Per-robot ROS2 node** wiring sensor adapters → SLAM → handler chain → `Sros2Bus`~~ → `src/specter/ros2/agent_node.py`
- ~~**Sensor topic adapters** — `sensor_msgs/LaserScan` → `RangeMeasurement[]`, `sensor_msgs/Imu` → `IMUSample`, custom UWB topic → beacon observations~~ → `src/specter/ros2/adapters.py`
- ~~**Roster bootstrap procedure** — operator key-gen ceremony, signed roster YAML, distribution mechanism~~ → `tools/gen_roster.py` + `src/specter/ros2/roster_loader.py`
- ~~**Operator dashboard node** — subscribes gossip / anomaly / fragments over DDS; renders the demo's right pane without the sim ground-truth overlay~~ → `src/specter/ros2/dashboard_node.py`
- **Per-robot calibration procedure** — IMU bias zeroing, UWB beacon range bias, lidar mount offsets, time-sync verification (`chronyc tracking`) — **Phase 2 work**
- ~~**systemd units** for the agent + dashboard processes~~ → `infra/systemd/specter-agent@.service` + `specter-dashboard.service`
- ~~**Runbook** (`docs/RUNBOOK.md`) — what each anomaly category means in the field, what to do under partition / time-sync loss / peer disappearance~~ → `docs/RUNBOOK.md` v0
- ~~**chrony / PTP setup** — required to keep the swarm within `validate_timestamp`'s 5s threshold~~ → `infra/chrony.conf` + RUNBOOK §1.2 verification step

### Policy decisions still owed (PRD-excluded; spec'd before behavior)

These are listed in `PRDs/sim-transport-identity/PRD.md` "Followup items." Each
is a runtime branch a robot needs an answer for the moment hardware encounters
it. They block hardware deployment, not implementation:

- **Watchdog: peer-silence timeout behavior** — drop reputations to prior, hold last-known, or refuse to act?
- **Fail-safe: self-in-minority-view** — defer to majority, maintain own view, or stop acting?
- **Graceful degradation: peer leave/rejoin under intermittent radio**
- **Time-source loss behavior** — when chrony falls over, what does the robot do?
- **Partition recovery: split-brain reconciliation** — when two isolated cliques rejoin, whose trust state wins?

---

## Promotion rules

- An item ships → strike through, link the commit/ADR.
- A gap turns into a decision → write an ADR; link it from this doc.
- A risk persists past sim → promote to `THREAT_MODEL.md` with measured bounds.

This document is working scaffolding. When the punch list empties out, it gets
reduced to a "phased deployment status" page and the rest moves to ADRs.
