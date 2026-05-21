ADR 0005: Sensor realism budget for Phase 1
============================================

Status: Accepted (2026-05-03)

Context
-------

Trust-engine evaluation against sim sensors is only meaningful if the sim
sensor model is honest about real-hardware failure modes. A purely analytical
ray-cast lidar with constant-σ Gaussian noise produces signals that are
too clean — detection bounds tuned in sim won't survive on real hardware.
But modeling every sensor failure mode is expensive and most don't change the
trust path's behavior.

Decision
--------

Phase 1 sim models the following sensor realism layers:

| Layer | Where | Constants |
|---|---|---|
| Lidar dropouts | `sim/sensors.py:lidar_scan` | `P_DROP=0.02`, beam returns `math.inf` |
| Lidar range-dependent noise | `sim/sensors.py:lidar_scan` | `σ = noise_std * (1 + d/10)` |
| IMU bias (initial + random walk) | `sim/sensors.py:IMUBias`, `propagate_imu_bias` | `INIT_BIAS_STD=0.01`, `BIAS_RW_STD=0.0005`/tick |
| UWB-style range beacons | `sim/beacons.py:range_beacons` | range σ=0.10m, bearing σ=5°, NLOS prob=2%, NLOS bias=0.5m |

**Amendment (2026-05-15, ADR 0015):** The UWB-beacon row is promoted from "realism flavor" to **the load-bearing trust contract**. As of the Range-Only Trust Voting PRD, the trust engine consumes `Observation.range_m` exclusively (Tier 1 reciprocal-range agreement uses `σ_combined = sqrt(2·σ_beacon² + σ_NLOS²) ≈ 0.165 m`; Tier 2 MDS builds the cohort distance matrix from the same scalars). Lidar dropouts and IMU bias remain SLAM-only — they no longer reach the trust path. A hardware port whose UWB matches this row (σ=0.10 m, NLOS 2% bias 0.5 m) will reproduce the eval-battery detection bounds for `range_lie`, `colluder_pair`, `beacon_spoof`, and `sensor_fuzz`.

All Gaussian noise + dropout decisions draw from a single seeded
`random.Random` so runs stay byte-for-byte reproducible.

Explicitly NOT modeled (with justification + revisit triggers):

- **Wall occlusion of beacons** — radio propagates further than line-of-sight
  in indoor 6.5 GHz UWB; the `BEACON_MAX_RANGE_M=8.0` cap dominates. *Revisit
  when:* hardware port adds materials with significant RF blocking, or
  multi-floor scenarios.
- **Async sensor cadences** (lidar 10 Hz, IMU 200 Hz) — the trust engine's
  logical-clock-from-envelope-timestamp design is already async-tolerant; sim
  is synchronous-tick for determinism. *Revisit when:* Phase 03 SROS2 port
  surfaces real ROS2 topics at native rates.
- **IMU temperature dependence and axis cross-coupling** — manifests as
  larger random-walk than a single Allan curve predicts. The current
  `BIAS_RW_STD` is tuned conservatively to absorb this. *Revisit when:* a
  physical IMU is benchmarked.
- **Lidar motion-induced beam skew** — beams within a scan have different
  timestamps as the robot moves. Negligible for our sub-1m/s agents.
  *Revisit when:* agent velocities exceed 5 m/s.
- **Lossy / jitter-y bus** — InProcessBus delivers in order with zero
  latency. Phase 03 transport will add real packet loss; we'd model with a
  `LossyBus` wrapper. *Revisit when:* SROS2 transport swap begins.
- **Nonholonomic motion** (differential drive: can't move sideways) —
  current `Agent.step` is holonomic. *Revisit when:* targeting differential-
  drive hardware (TurtleBot4) for end-to-end demo.

Consequences
------------

Positive:
- Trust engine detection bounds are now validated against sensor noise at
  realistic levels, not the analytical-clean baseline.
- The IMU bias model lets us simulate `odometry_corrupt` attacks (compromised
  hardware reports honestly-broken data).
- Beacons replace the ground-truth `subject_id`-tagged observation cheat,
  bringing the model closer to UWB-equipped multi-robot hardware (Crazyflie
  Loco, DWM1000-class).

Negative:
- Test thresholds are tighter than the pre-realism baseline; future tuning
  changes need to re-run the battery to confirm rank-ordering survives.
- The "explicitly not modeled" list is technical debt that bites at the
  sim→hardware boundary if we don't address it before each port.
