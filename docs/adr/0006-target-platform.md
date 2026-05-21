ADR 0006: Target platform — ROS2 + Gazebo, then UWB-ranging hardware
=====================================================================

Status: Accepted (2026-05-03)

Context
-------

Phase 1 is pure-Python sim (per ADR 0001). Phase 03 ports onto real ROS2
infrastructure. Decisions made today — frame conventions, message rates,
sensor topics, transport assumptions — either match the eventual target or
require a refactor at port time. Naming the target now sharpens those
decisions.

Decision
--------

Phase 03 target platform pyramid:

1. **ROS2 (Humble) + Gazebo simulation.** Bridges Phase 1 sim → real ROS2
   transport without buying hardware. SROS2 enables signed nodes which
   matches our `Envelope` contract directly.
2. **TurtleBot4** for ground-robot validation. Stock ROS2 stack, lidar,
   wheel encoders → `/odom` topic, IMU. Existing Nav2 SLAM stack provides
   a reference to compare our trust-overlay against.
3. **Crazyflie 2.1 + Loco Positioning** for swarm validation. UWB-based
   ranging is exactly the model in `sim/beacons.py`. Cheap (~$200/unit), so
   a 4-6-agent swarm is realistic.

Implications for Phase 1 design choices:

- **Frame discipline.** Names follow ROS2/REP-105 conventions where
  ambiguous: `pose_in_map`, `obs_in_sensor`, `imu_in_body`. tf2 itself is
  not introduced in Phase 1, but the convention prevents an awkward rename
  pass at port time.
- **Beacon model matches Loco.** `BEACON_RANGE_SIGMA=0.10m` matches DWM1000
  observed performance; `BEACON_BEARING_SIGMA=5°` is the PDOA noise floor
  for that band. Tuning constants come from the target hardware, not
  arbitrary choices.
- **Body-frame bearing in `RangeMeasurement.angle`.** Matches what real
  lidars publish (angle relative to sensor, not world). World-frame
  conversion happens at the trust path's edge.
- **Signed envelope contract is transport-agnostic.** ECDSA over canonical
  JSON in Phase 1; SROS2 wraps the same envelope shape over DDS in Phase 03.
- **Async-safe logical clocks.** Trust engine indexes time off
  `envelope.timestamp_ns`, not wall-clock — survives the lidar-10Hz /
  IMU-200Hz / radio-burst cadence mismatch real hardware will have.

Consequences
------------

Positive:
- Decisions made now have a north star to be audited against.
- Sim sensor models (lidar dropouts, IMU bias, UWB beacons) are calibrated
  against real-hardware datasheets, not made up.
- Future contributors know what the project is reaching for.

Negative:
- Lock-in to ROS2 specifically — alternatives (e.g., ROS1, a bespoke ZMQ
  transport, microROS-only) become more expensive to revisit.
- Hardware purchase decisions are now in scope for project planning,
  even if not for Phase 1.

Revisit when
------------

- A different transport substrate proves itself superior for Byzantine-
  resilient swarm communication.
- Hardware availability or cost shifts the platform calculus (e.g., a
  different UWB module dominates the swarm-research market).

Addendum (2026-05-17, ADR 0016 Wave 0.5)
----------------------------------------

Pose-graph SLAM substrate composition: the new `PoseGraphSlam` ABC
(`interfaces.py`, sibling to `LocalSlam`) **consumes** odometry from
`LocalSlam.pose()` — `DeadReckoningSlam` and `ScanMatchSlam` remain the
streaming-pose providers. Hardware path: `PoseGraphSlam` is satisfied
by an adapter to Cartographer (TurtleBot4) or the Crazyflie UWB pose
graph; the sim pose graph (Wave 1+) is the workshop teaching artifact
and production-grade MVP, not the on-robot stack. Detail in ADR 0016.
