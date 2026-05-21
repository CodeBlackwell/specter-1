ADR 0004: Dead-reckoning Local SLAM in Phase 1, scan-match deferred
====================================================================

Status: Accepted (2026-05-03)

Context
-------

`LocalSlam` is a Phase 0 ABC; Phase 1 needs a concrete implementation so the
trust engine stops operating on ground-truth pose. The space of viable
estimators ranges from pure dead-reckoning (~80 LOC) to particle-filter SLAM
(~500 LOC). Larger estimators bring tooling and tuning cost that delay the
trust-protects-real-data milestone.

Decision
--------

Slice-1 estimator is `DeadReckoningSlam` (`src/specter/slam/local.py`):

- Theta integrated from the IMU gyro tick-by-tick.
- World-frame velocity held constant from a constructor seed (`init_velocity`),
  analogous to a robot's commanded cruise or a wheel-encoder readout sampled
  at start-up.
- xy integrated each tick from the held velocity.
- `map_fragment()` returns JSON bytes of the latest non-dropout scan; this is
  a stub serialization until `MapMerger` lands.

Scan-matching (ICP-lite over consecutive scans, bounded drift in static maps)
is a follow-up slice; particle filters are deferred until MapMerger requires
an occupancy grid.

Consequences
------------

Positive:
- Trust engine now runs on a SLAM-derived pose source, not sim ground truth.
  Detection signals reflect what real hardware would produce.
- Fits behind the existing ABC with no signature change.
- Drift behavior is predictable: gyro bias accumulates into theta error,
  observations rotate around the agent. SLAM-native attacks
  (`odometry_corrupt`) exercise this surface.

Negative:
- Held-velocity assumption breaks when agents change speed mid-run (e.g.,
  bouncing off walls in long scenarios). Eval scenarios are sized to avoid
  the breakdown for now.
- xy never observes scan data — drift in xy is purely from gyro-driven
  rotation of the assumed velocity vector. A scan-match upgrade is required
  before extended runs or dynamic-velocity worlds can be eval'd.

Revisit when
------------
- MapMerger needs richer `map_fragment()` output.
- Eval scenarios extend past ~200 ticks with bouncing walls.
- Hardware port surfaces real wheel-encoder topics that the SLAM should
  consume directly.
