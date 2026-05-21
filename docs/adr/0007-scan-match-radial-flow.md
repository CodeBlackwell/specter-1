ADR 0007: Scan-match SLAM upgrade — radial-flow velocity recovery
====================================================================

Status: Accepted (2026-05-04)

Context
-------

ADR 0004 chose dead-reckoning as the slice-1 SLAM with held world-frame
velocity, deferring scan-match. Empirical confirmation of the breakdown
(commit `e4cb290`+slam-drift, `tests/eval/test_slam_drift.py`):

- 80 ticks pre-bounce: 0.95 m drift (gyro bias rotating velocity vector).
- 200 ticks (1+ bounces): 12.95 m — completely wrong.
- 400 ticks (2+ bounces): 16.85 m.

Bouncing scenarios, speed changes, and any held-velocity-assumption error
diverge unboundedly because the estimator never observes its own xy.

Decision
--------

Slice-2 SLAM is `ScanMatchSlam` (`src/specter/slam/scan_match.py`):

- Theta still gyro-driven (unchanged from slice 1).
- xy from radial-flow velocity recovery: each beam matched between
  consecutive scans satisfies ``Δr ≈ -(vx_body cos θ + vy_body sin θ) × dt``.
  Pool matched beams via 2×2 closed-form least-squares (normal equations
  inverted by hand — no numpy dependency); recover body-frame velocity;
  rotate to world frame using current theta; integrate.
- Beam-jump filter: skip pairs with ``|Δr| > 0.5 m`` (typically a corner
  jump where the beam moved to a different surface).
- Bootstrap: first tick uses the constructor's `init_velocity` (no prior
  scan to match against). Subsequent ticks use scan-match.

`DeadReckoningSlam` is retained — it backs the negative test in
`tests/eval/test_slam_drift.py::test_dead_reckoning_diverges_at_bounce`,
locking in the gap that scan-match closes.

Empirical drift with `ScanMatchSlam` on the same bouncing scenario:

- 80 ticks: 0.41 m (2.3× better than dead-reckoning).
- 200 ticks: 0.50 m (26× better).
- 400 ticks: 0.97 m (17× better).

Test bounds asserted in CI:

- `test_scan_match_bounded_through_bounces`: drift < 1.5 m at 200 ticks.
- `test_scan_match_bounded_at_400_ticks`: drift < 2.0 m at 400 ticks.

Why radial-flow over ICP
------------------------

Closed-form 2×2 LSQ runs in O(beams) per tick — no iteration, no
correspondence search, no convergence handling. Sufficient for our slow
(< 1 m/s) ground robots whose rotation per tick is small enough that
body-frame beam angles point at approximately the same world-frame
direction tick-over-tick. ICP would buy negligible accuracy at this speed
range and 5× the LOC.

Revisit when
------------

- Agent velocities exceed ~5 m/s where rotation per tick gets large
  enough that `Δθ` pre-rotation of the previous scan is required (or
  full ICP).
- Lidar starts seeing dynamic obstacles (other agents, moving objects);
  current sim's `lidar_scan` ignores agents and only reflects walls.
  Radial-flow assumes static features.
- Beam count drops below ~8 (the LSQ becomes ill-conditioned). Current
  16 beams gives plenty of margin.
- TurtleBot4 hardware port surfaces real ROS2 lidar topics with
  per-beam timestamps inside a scan; the angle-bucket lookup in
  `_estimate_body_velocity` would need to match by world-frame angle
  rather than body-frame.

Consequences
------------

Positive:
- Cooperative-SLAM half is now structurally usable past dead-reckoning's
  breakdown point — longer scenarios, bouncing walls, dynamic-velocity
  worlds all stay bounded.
- The trust engine continues to operate on a SLAM-derived pose source.
  Scan-match noise enters the trust path as bounded jitter, not as
  unbounded divergence.
- MapMerger can now consume `map_fragment()` over arbitrary run lengths
  without the SLAM itself being the source of confounding error.

Negative:
- `lidar_scan`'s static-feature assumption is now load-bearing for SLAM,
  not just for visualization. Radial-flow against dynamic obstacles
  produces biased velocity. Document in ADR 0005 if not already there.
- The 0.5 m beam-jump threshold is hand-tuned. A noisier lidar or
  faster rotation regime would need re-tuning.
