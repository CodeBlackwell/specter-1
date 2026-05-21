ADR 0012: Per-topic QoS profiles for `Sros2Bus`
==================================================

Status: Accepted (2026-05-05)

Context
-------

`Sros2Bus` (ADR 0011) shipped with a single integer `queue_depth=10` for
every topic. ROS2/DDS exposes a richer QoS surface — reliability,
durability, history depth, lifespan — and the four envelope topics in
specter-1 have meaningfully different freshness vs delivery semantics:

- `pose` is per-tick, latest-wins. A late sample is stale.
- `observation` is per-tick *cohort*. Drops bias the range-only vote
  (Tier 1 reciprocal-range check needs both directions; Tier 2 MDS needs
  the full distance matrix per ADR 0015), so each tick's observations
  need to land.
- `reputation` is async gossip. Loss directly costs convergence speed.
- `beacon` (when published as a standalone topic) mirrors `pose` shape.

Two failure modes if we keep one profile for all topics:

- All-RELIABLE: latency on `pose`/`beacon` because DDS holds the slot
  for re-transmits when the next sample is already available and would
  preempt the late one.
- All-BEST_EFFORT: lossy `reputation` and `observation` traffic, which
  costs trust convergence and can warp voting cohorts.

Decision
--------

Add a `transport.qos` module that maps topic name → `QoSProfile`:

| Topic | Reliability | History | Depth | Lifespan |
|---|---|---|---|---|
| `pose` | BEST_EFFORT | KEEP_LAST | 1 | 1 publish interval (50 ms @ 20 Hz) |
| `observation` | RELIABLE | KEEP_LAST | 20 | 2 publish intervals |
| `reputation` | RELIABLE | KEEP_LAST | 10 | 1 s |
| `beacon` | BEST_EFFORT | KEEP_LAST | 1 | 1 publish interval |
| _unknown_ | RELIABLE | KEEP_LAST | 10 | 0 (never expire) |

`Sros2Bus` accepts an optional `qos_for_topic` callable. When provided,
publishers and subscribers use the per-topic profile. When omitted, the
bus falls back to its previous `queue_depth` integer behavior — existing
call sites are unaffected.

`QoSProfile` is a small dataclass (transport-agnostic). `to_rclpy(profile)`
materializes a real `rclpy.qos.QoSProfile` at the bus boundary. Tests
without rclpy can introspect the dataclass directly.

Rationale per topic
-------------------

**`pose` — BEST_EFFORT, depth 1, lifespan 50 ms.**
At 20 Hz tick rate, a pose sample older than the next tick is stale.
Trust voting uses the *latest* claim, not a backlog. RELIABLE on pose
would burn airtime resending samples that the receiver would discard
on arrival. Lifespan 50 ms makes this explicit at the DDS layer.

**`observation` — RELIABLE, depth 20, lifespan 100 ms.**
The trust evaluator buckets observations by `(subject_id, timestamp)`
and votes a *closed cohort* (cohort closes when a later-timestamp
envelope arrives). A dropped observation in that cohort biases the
weighted median, which directly distorts the outlier blame. Depth 20
holds a per-tick burst from up to ~20 peers without overflow. Lifespan
100 ms (two ticks) is the cohort's natural maximum age.

**`reputation` — RELIABLE, depth 10, lifespan 1 s.**
Gossip is async and not per-tick — agents publish on a slower cadence
once their snapshot has changes. Loss costs convergence speed of trust
state across the swarm; eventual delivery is what matters. Depth 10
covers a small swarm without holding history forever (lifespan 1 s caps
how stale an undelivered gossip sample is allowed to be).

**`beacon` — BEST_EFFORT, depth 1, lifespan 50 ms.**
Same shape as `pose`: latest-wins, freshness over delivery. Listed here
so a future deployment that publishes raw UWB ranges as their own topic
gets the right defaults from day one.

**Unknown topic — RELIABLE, depth 10, no lifespan.**
The conservative fallback that mirrors pre-Wave-3 behavior. A new topic
that doesn't yet have a deliberate profile gets durable delivery rather
than silently dropping packets — preferable to a latency-optimized
default that surprises a trust-related code path.

What this protects against
--------------------------

- *Cohort skew under packet loss* — RELIABLE on `observation` keeps the
  range-only vote unbiased (Tier 1 reciprocal-pair check needs the full
  cohort to compare `r(O→S)` against `r(S→O)`; Tier 2 MDS needs the
  complete cohort distance matrix — ADR 0015).
- *Stale-pose decisions* — BEST_EFFORT + lifespan on `pose`/`beacon`
  prevents an old sample from arriving after the trust evaluator has
  already moved past that tick.
- *Slow gossip convergence* — RELIABLE on `reputation` costs a few
  bytes of overhead but caps the time to consensus on trust state.

Consequences
------------

Positive:
- Each topic gets the trade-off appropriate to its semantics; no blanket
  over-protection or under-protection.
- Opt-in: existing `Sros2Bus(node)` callers see no behavior change.
- Single integration point — one module, one mapping table — so a
  deployment can override the table for a specific radio without
  forking transport code.

Negative:
- Two more knobs in the deployment surface (`qos_for_topic` callable +
  `to_rclpy` conversion). The previous `queue_depth=10` was a single
  scalar; the per-topic table is structured.
- Empirical validation pending. Real-radio measurements (Phase 1+
  Gazebo / Phase 2 TurtleBot4) will tell us whether the profile depths
  and lifespans are right. The constants here are reasoned from the
  trust engine's data flow, not measured on hardware.

Revisit when
------------

- A real radio (Crazyflie+UWB in particular) shows that lifespan
  values force premature drops, or that depth values overflow under
  burst.
- A new topic is added — assign it an explicit profile rather than
  relying on the unknown-topic fallback.
- DDS-level QoS *requests* vs *offers* surface a compatibility issue
  between two specter-1 nodes (e.g., one publishing BEST_EFFORT and a
  subscriber demanding RELIABLE — DDS won't connect them).
