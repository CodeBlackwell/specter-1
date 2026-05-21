ADR 0010: Trust-weighted occupancy-grid voting for map merging
====================================================================

Status: Accepted (2026-05-05)

Context
-------

The cooperative-SLAM half of the project requires fusing each peer's
`map_fragment()` into a single shared map. The merger has to (a)
produce a representation honest peers' geometries can agree on and
(b) take a per-peer trust weight so a low-rep peer's contributions
shrink instead of being included whole. The trust path computes
peer reputation downstream of every observation; the merger's job is
to consume that scalar and let it govern the fusion.

Three plausible representations were considered:

1. **Raw fragment union** — keep every peer's scan list, hand it to
   downstream consumers. No fusion. Trust would have to be applied at
   the consumer.
2. **Feature-based map** (line segments, surfels, landmarks) — extract
   geometric primitives from each fragment, match across peers,
   weighted-average parameters.
3. **Occupancy grid with weighted voting** — discretize the world into
   cells, ray-cast each scan, accumulate weighted free/occupied votes
   per cell, threshold to a binary grid.

Decision
--------

`OccupancyMapMerger` (`src/specter/slam/map_merger.py`) implements (3).
Each fragment carries `agent_id`, `pose`, and `scans`. The merger:

- ray-casts each non-dropout beam from the fragment's reported pose,
- marks every cell traversed as **free** with weight `peer_weights[id]`,
- marks the endpoint cell as **occupied** with the same weight,
- emits a binary grid where cell `(i, j)` is occupied iff the cell's
  occupied-vote total exceeds its free-vote total.

`peer_weights` defaults to `1.0` for unknown peers, so a caller that
doesn't wire trust gets a uniform-weighted merge with no API change.

Why occupancy voting over the alternatives
------------------------------------------

**Raw fragment union** punts the trust problem. Every consumer would
have to re-implement weighted fusion. The merger's whole point is to
produce a single artifact that downstream code (visualization, planner,
loop closure) consumes without re-doing trust math.

**Feature-based maps** are higher-fidelity but require feature
extraction, cross-peer correspondence, and outlier handling — none of
which compose cleanly with a per-peer scalar weight. A peer reporting
a wrong wall has to be down-weighted at the **feature-match** level,
not the per-cell level, which means the merger needs to understand
which features came from which peers and re-run matching when weights
change. That's a large amount of state for a slice that has to call
`merge(fragments)` from the demo loop.

Occupancy voting trades fidelity for compositional simplicity. Trust
enters as a multiplier on every vote; the merger has no internal
state across calls; the output is a single binary grid easy to compare
against ground truth in eval and easy to overlay in the demo. The
trust-weighted-vs-uniform contrast is the load-bearing claim of the
slice and falls out of the math directly: with weights `w_i`, cell
occupancy depends on `Σ w_i · v_i`, so a low `w` peer's contribution
is proportionally suppressed.

Why a binary grid (occ > free) instead of log-odds
--------------------------------------------------

Standard occupancy mapping uses log-odds with a configurable threshold
and per-beam likelihoods. We picked the simpler `occ > free` rule
because:

- The eval shows it already meets the recall/precision thresholds
  (≥ 90% / ≥ 95% on the 4-honest scenario, ≥ 85% / ≥ 90% under
  trust-weighted adversarial fusion).
- Log-odds adds a tunable parameter (the threshold) that would have
  to be re-justified per scenario. The eval in the current slice would
  not distinguish the two.
- The trust-weighting story is cleaner: a low-rep peer's vote
  literally subtracts proportionally less from the cell's tally,
  rather than entering through a separate likelihood term.

Revisit when:

- Lidar fidelity drops (e.g., 8-beam Crazyflie deck-mounted ToF) and
  per-beam likelihood needs to model the higher noise floor explicitly.
- The merger has to fuse with a prior map (real building floorplan).
  Log-odds composes additively with a prior in a way the binary rule
  doesn't.
- A planner is wired downstream that needs continuous occupancy
  probabilities (e.g., A* with risk costs). The current binary output
  is enough for visualization and loop closure.

Pose carriage
-------------

The locked `LocalSlam.map_fragment()` payload — set in Phase 0 — is
`{agent_id, t, scans}` with no pose. Ray-casting needs pose. The
merger expects fragments in an extended shape with a `pose` field;
`map_merger.encode_fragment(agent_id, pose, scans)` builds the
correct payload. Callers wire pose at fragment-publish time
(typically `slam.pose()` immediately after `slam.update()`). This
keeps the locked ABC unchanged while letting the merger do its job.

Why not modify the ABC? Phase 0 said the ABCs lock — every consumer
of `map_fragment()` would otherwise have to update. The augmented
shape is a superset, so a future iteration could fold pose into the
ABC without breaking anyone.

Loop closure
------------

`detect_loop_closure(scan, pose, merged_map)` predicts scan endpoints
and returns True iff at least 50% of valid endpoints lie within the
threshold of an occupied cell. It does **not** correct the SLAM pose
— that's a future slice and would have to round-trip through
`ScanMatchSlam`'s state. The detection signal is enough for the demo
to flag loop closures visually and for downstream consumers to
schedule a global pose-graph optimization.

Insufficient-evidence guard (`MIN_VALID_BEAMS = 3`) prevents loop
closure firing on dropouts: a tick where every beam returned `inf`
returns False, not "match" by trivial vacuous-truth.

Consequences
------------

Positive:

- Cooperative-SLAM half is now structurally complete. The 4-peer
  honest swarm produces a merged map matching ground truth at the
  resolution chosen for the eval (0.2 m/cell).
- Trust-weighted fusion is demonstrated to suppress a 10x-amplified
  liar with `+2 m` offset walls; uniform-weighted fusion drops below
  70% precision under the same input, locking in the trust-engine's
  load-bearing role in the merged map.
- Loop-closure detection ships as a callable signal that downstream
  code (planner, demo) can consume without modifying `ScanMatchSlam`.

Negative:

- Resolution is a tunable per-merger; the 0.2 m default in the eval
  is finer than the 0.1 m ABC default because the 144→120-beam lidar
  used in eval still leaves coverage gaps at 0.1 m. A real lidar
  (~720 beams) wouldn't have this issue.
- The merger is O(beams × ray-length-in-cells) per `merge()` call.
  With 200 ticks of 4 peers at 120 beams = ~96 000 beams per merge
  and ~50 cells per ray, a single merge is ~5 M cell updates —
  ~7-10 s in CPython. A vectorized (numpy) implementation or a Cython
  ray-cast would be the obvious next step if the merger has to run
  at sim tick rate in the demo.
- Pose carriage in fragments is "by convention" rather than enforced
  by the type system. A peer that publishes a fragment without pose
  is silently skipped by the merger, which is the right default but
  could mask a wiring bug. Phase 4 should consider promoting pose
  into the locked ABC and adding a typed payload schema.
